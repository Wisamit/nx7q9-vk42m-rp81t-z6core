import { inflateRawSync } from "node:zlib";
export class XlsxStagingError extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

export const XLSX_STAGE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_TOTAL = 12 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100;
const decoder = new TextDecoder("utf-8", { fatal: true });
const required = ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"];
const max = (buffer: Buffer, offset: number, bytes: number) => {
  if (offset < 0 || offset + bytes > buffer.length) throw new XlsxStagingError("xlsx_corrupt_zip");
};
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function extractTextFiles(raw: Uint8Array): Map<string, string> {
  if (raw.byteLength === 0 || raw.byteLength > XLSX_STAGE_MAX_BYTES)
    throw new XlsxStagingError("xlsx_file_too_large");
  const bytes = Buffer.from(raw);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxStagingError("xlsx_corrupt_zip");
  max(bytes, eocd, 22);
  const disk = bytes.readUInt16LE(eocd + 4), total = bytes.readUInt16LE(eocd + 10);
  const count = bytes.readUInt16LE(eocd + 8), centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk || count !== total || !total || total > MAX_ZIP_ENTRIES ||
      centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralSize !== eocd)
    throw new XlsxStagingError("xlsx_unsupported_zip");
  const result = new Map<string, string>();
  let offset = centralOffset, expandedTotal = 0;
  for (let i = 0; i < total; i++) {
    max(bytes, offset, 46);
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new XlsxStagingError("xlsx_corrupt_zip");
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const outputSize = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    max(bytes, offset, 46 + nameLen + extraLen + commentLen);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (!name || result.has(name) || name.includes("\\") || name.includes("..") ||
        name.startsWith("/") || name.includes("\0") || !/^[\w./\[\]-]+$/.test(name) ||
        (flags & 1) !== 0 || ![0, 8].includes(method) ||
        compressedSize === 0xffffffff || outputSize === 0xffffffff ||
        outputSize > MAX_UNCOMPRESSED_ENTRY || compressedSize > XLSX_STAGE_MAX_BYTES ||
        (compressedSize === 0 && outputSize > 0))
      throw new XlsxStagingError("xlsx_unsupported_or_unsafe_zip_entry");
    if (/(?:vba|externalLinks|embeddings|activex|connections\.xml|queryTables|oleObject)/i.test(name))
      throw new XlsxStagingError("xlsx_external_or_executable_content_forbidden");
    expandedTotal += outputSize;
    if (expandedTotal > MAX_UNCOMPRESSED_TOTAL)
      throw new XlsxStagingError("xlsx_uncompressed_limit_exceeded");
    max(bytes, localOffset, 30);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50 ||
        bytes.readUInt16LE(localOffset + 8) !== method)
      throw new XlsxStagingError("xlsx_local_header_mismatch");
    const localNameLen = bytes.readUInt16LE(localOffset + 26), localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtra;
    max(bytes, localOffset, 30 + localNameLen + localExtra);
    if (decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen)) !== name)
      throw new XlsxStagingError("xlsx_local_header_mismatch");
    max(bytes, start, compressedSize);
    let inflated: Buffer;
    try {
      inflated = method === 0
        ? bytes.subarray(start, start + compressedSize)
        : inflateRawSync(bytes.subarray(start, start + compressedSize),
          { maxOutputLength: MAX_UNCOMPRESSED_ENTRY });
    } catch { throw new XlsxStagingError("xlsx_decompression_rejected"); }
    if (inflated.byteLength !== outputSize || crc32(inflated) !== checksum)
      throw new XlsxStagingError("xlsx_crc_or_length_mismatch");
    if (name.endsWith(".xml") || name.endsWith(".rels") || name === "[Content_Types].xml") {
      const text = decoder.decode(inflated);
      if (/<!\s*(?:DOCTYPE|ENTITY)|<\?xml-stylesheet/i.test(text))
        throw new XlsxStagingError("xlsx_unsafe_xml");
      result.set(name, text);
    } else result.set(name, "");
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (offset !== eocd || required.some(path => !result.has(path)))
    throw new XlsxStagingError("xlsx_missing_required_parts");
  if ([...result.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length !== 1)
    throw new XlsxStagingError("xlsx_multiple_worksheets_not_supported");
  return result;
}
function xmlDecode(input: string): string {
  if (input.includes("<")) throw new XlsxStagingError("xlsx_malformed_cell_text");
  if (/&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(input))
    throw new XlsxStagingError("xlsx_unsupported_xml_entity");
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_token, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const n = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (n > 0x10ffff || n < 32 && n !== 9 && n !== 10 && n !== 13 || n >= 0xd800 && n <= 0xdfff)
      throw new XlsxStagingError("xlsx_invalid_xml_entity");
    return String.fromCodePoint(n);
  });
}
function texts(xml: string): string {
  let output = "", count = 0;
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    output += xmlDecode(m[1]); count++;
  }
  if (!count && /<t\b/.test(xml)) throw new XlsxStagingError("xlsx_invalid_inline_string");
  if (output.length > 8192) throw new XlsxStagingError("xlsx_cell_too_long");
  return output;
}
function colIndex(label: string) {
  let i = 0;
  for (const c of label) i = i * 26 + c.charCodeAt(0) - 64;
  return i - 1;
}
function attr(input: string, key: string) {
  const result = new RegExp('(?:^|\\s)' + key + '="([^"]*)"').exec(input);
  return result?.[1] ?? null;
}
/**
 * Limited safe XLSX reader: one visible sheet, scalar strings/numbers, no formulas.
 * Produces canonical CSV consumed by existing strict staged-import validator.
 * Never coerces date/price/unit values, executes links or activates configuration.
 */
function decodeXlsxReview(upload: Uint8Array): string {
  const files = extractTextFiles(upload);
  const book = files.get("xl/workbook.xml")!;
  const workbookRels = files.get("xl/_rels/workbook.xml.rels");
  if (!workbookRels || /TargetMode\s*=\s*"External"/i.test(workbookRels) ||
      [...files.entries()].some(([name, xml]) => name.endsWith(".rels") &&
        /TargetMode\s*=\s*"External"/i.test(xml)))
    throw new XlsxStagingError("xlsx_external_relationship_forbidden");
  const sheets = [...book.matchAll(/<sheet\b([^>]*)\/?>/g)];
  if (sheets.length !== 1 || /state="hidden"|state="veryHidden"/i.test(sheets[0][1]))
    throw new XlsxStagingError("xlsx_visible_single_sheet_required");
  const relationshipId = attr(sheets[0][1], "r:id");
  const links = [...workbookRels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)];
  if (!relationshipId || !links.some(link => attr(link[1], "Id") === relationshipId &&
      attr(link[1], "Target") === "worksheets/sheet1.xml" &&
      attr(link[1], "Type")?.endsWith("/worksheet")))
    throw new XlsxStagingError("xlsx_sheet_relationship_mismatch");
  const shared = files.get("xl/sharedStrings.xml");
  const strings: string[] = [];
  if (shared) {
    for (const match of shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      strings.push(texts(match[1]));
      if (strings.length > 200000) throw new XlsxStagingError("xlsx_too_many_shared_strings");
    }
  }
  const sheet = files.get("xl/worksheets/sheet1.xml")!;
  if (/<f(?:\s|>)|<mergeCells\b|<sheetProtection\b/i.test(sheet) ||
      /<col\b[^>]*\bhidden\s*=\s*"(?:1|true)"/i.test(sheet))
    throw new XlsxStagingError("xlsx_formulas_or_merged_cells_forbidden");
  // Reject unrecognized worksheet markup *inside the table*, rather than
  // dropping its values while claiming that staging succeeded. Missing or
  // duplicate sheetData, rows, cells or hidden rows are not review evidence.
  const dataSections = [...sheet.matchAll(/<sheetData(?:\s[^>]*)?>([\s\S]*?)<\/sheetData>/g)];
  if (dataSections.length !== 1 ||
      [...sheet.matchAll(/<sheetData\b/g)].length !== 1 ||
      !/<worksheet\b/.test(sheet))
    throw new XlsxStagingError("xlsx_invalid_sheet_data");
  const dataXml = dataSections[0][1];
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  if (dataXml.replace(rowPattern, "").trim() !== "")
    throw new XlsxStagingError("xlsx_unparsed_sheet_row");
  const table: string[][] = [];
  let rowNumber = 0;
  for (const match of dataXml.matchAll(rowPattern)) {
    const position = Number(attr(match[1], "r"));
    if (!Number.isInteger(position) || position !== rowNumber + 1 ||
        position > 20001 || ["1", "true"].includes(attr(match[1], "hidden") ?? ""))
      throw new XlsxStagingError("xlsx_invalid_row_number_or_hidden");
    rowNumber = position;
    const cells: string[] = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    if (match[2].replace(cellPattern, "").trim() !== "")
      throw new XlsxStagingError("xlsx_unparsed_sheet_cell");
    for (const cell of match[2].matchAll(cellPattern)) {
      const location = attr(cell[1], "r");
      const ref = /^([A-Z]{1,3})(\d{1,6})$/.exec(location ?? "");
      if (!ref || Number(ref[2]) !== position) throw new XlsxStagingError("xlsx_invalid_cell_reference");
      const column = colIndex(ref[1]);
      if (column < 0 || column >= 32 || cells[column] !== undefined)
        throw new XlsxStagingError("xlsx_duplicate_or_too_many_columns");
      const t = attr(cell[1], "t") ?? "n";
      let content = "";
      if (t === "inlineStr") {
        const inlinePattern = /<is\b[^>]*>([\s\S]*?)<\/is>/g;
        const inline = [...cell[2].matchAll(inlinePattern)];
        if (inline.length !== 1 || cell[2].replace(inlinePattern, "").trim() !== "")
          throw new XlsxStagingError("xlsx_invalid_inline_string");
        const stringBody = inline[0][1];
        // Basic rich-text run containers are accepted, but unsupported
        // embedded elements must never be silently omitted from values.
        const leftover = stringBody.replace(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g, "")
          .replace(/<\/?r(?:\s[^>]*)?>/g, "").trim();
        if (leftover) throw new XlsxStagingError("xlsx_unparsed_cell_text");
        content = texts(stringBody);
      } else if (t === "s" || t === "str" || t === "n") {
        const valuePattern = /<v>([\s\S]*?)<\/v>/g;
        const values = [...cell[2].matchAll(valuePattern)];
        if (values.length > 1 || cell[2].replace(valuePattern, "").trim() !== "")
          throw new XlsxStagingError("xlsx_unparsed_cell_value");
        content = values[0] ? xmlDecode(values[0][1]) : "";
        if (t === "s") {
          if (!/^(?:0|[1-9]\d*)$/.test(content) || Number(content) >= strings.length)
            throw new XlsxStagingError("xlsx_invalid_shared_string");
          content = strings[Number(content)];
        }
      } else throw new XlsxStagingError("xlsx_non_scalar_cell_forbidden");
      if (content.length > 8192 || content.includes("\0"))
        throw new XlsxStagingError("xlsx_cell_too_long");
      cells[column] = content;
    }
    table.push(cells);
  }
  if (table.length < 2 || !table[0].includes("entityType"))
    throw new XlsxStagingError("xlsx_missing_review_headers_or_rows");
  const width = table[0].length;
  if (width > 32 || width === 0 || table.some(row => row.slice(width).some(x => x !== "")))
    throw new XlsxStagingError("xlsx_column_count_mismatch");
  // Canonical quoted CSV leaves decimals and dates as exact lexemes. Existing
  // parseCsvReviewFile strictly rejects unknown column names/entity types.
  const csv = table.map(row => Array.from({length:width}, (_,i) =>
    '"' + (row[i] ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
  if (Buffer.byteLength(csv, "utf8") > 2 * 1024 * 1024)
    throw new XlsxStagingError("csv_file_too_large");
  return csv;
}

/** Convert all parser/UTF-8 failures to one safe, non-leaking staging error family. */
export function xlsxReviewToCsv(upload: Uint8Array): string {
  try { return decodeXlsxReview(upload); }
  catch (error) {
    if (error instanceof XlsxStagingError) throw error;
    throw new XlsxStagingError("xlsx_malformed_or_invalid_utf8");
  }
}
