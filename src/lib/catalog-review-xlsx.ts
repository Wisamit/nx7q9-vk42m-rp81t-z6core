/**
 * Native, single-worksheet XLSX writer for human-review catalog CSV and canonical
 * staging templates. Uses UTF-8 inline strings and ZIP STORED entries, no
 * spreadsheet formulas, no browser dependencies and no clinical writes.
 */
export class XlsxReviewError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const encoder = new TextEncoder();
const MAX_SHEET_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_ROWS = 20001;
const MAX_COLUMNS = 200;

export function parseReviewCsvCells(text: string): string[][] {
  if (encoder.encode(text).byteLength > MAX_SHEET_BYTES) throw new XlsxReviewError("xlsx_source_too_large");
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!source || source.includes("\0")) throw new XlsxReviewError("xlsx_invalid_source_csv");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quote = false, endedQuote = false, started = false;
  function pushCell() {
    row.push(cell);
    if (row.length > MAX_COLUMNS) throw new XlsxReviewError("xlsx_too_many_columns");
    cell = ""; endedQuote = false; started = false;
  }
  function pushRow() {
    pushCell();
    if (row.some(value => value !== "") || rows.length === 0) rows.push(row);
    else throw new XlsxReviewError("xlsx_empty_row");
    if (rows.length > MAX_ROWS) throw new XlsxReviewError("xlsx_too_many_rows");
    row = [];
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else { quote = false; endedQuote = true; }
      } else cell += c;
    } else if (c === ",") pushCell();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] !== "\n") throw new XlsxReviewError("xlsx_invalid_newline");
      if (c === "\r") i++;
      pushRow();
    } else if (endedQuote) throw new XlsxReviewError("xlsx_invalid_quote");
    else if (c === '"') {
      if (started) throw new XlsxReviewError("xlsx_invalid_quote");
      quote = true; started = true;
    } else { cell += c; started = true; }
    if (cell.length > 8192) throw new XlsxReviewError("xlsx_cell_too_long");
  }
  if (quote) throw new XlsxReviewError("xlsx_unclosed_quote");
  if (cell || row.length || endedQuote) pushRow();
  if (!rows.length || rows.some(row => row.length !== rows[0].length))
    throw new XlsxReviewError("xlsx_column_count_mismatch");
  return rows;
}
function xmlEscape(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "\uFFFD")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function col(index: number): string {
  let result = "", n = index + 1;
  while (n) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); }
  return result;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function assemble(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const part of parts) n += part.byteLength;
  if (n > MAX_FILE_BYTES) throw new XlsxReviewError("xlsx_file_too_large");
  const out = new Uint8Array(n);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.byteLength; }
  return out;
}
function zipStored(files: Array<[string, string]>): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let cursor = 0;
  for (const [name, text] of files) {
    const filename = encoder.encode(name), content = encoder.encode(text), checksum = crc32(content);
    if (filename.length > 255 || content.length > MAX_SHEET_BYTES) throw new XlsxReviewError("xlsx_file_too_large");
    const head = new Uint8Array(30 + filename.length);
    const d = new DataView(head.buffer);
    d.setUint32(0, 0x04034b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 0x0800, true);
    d.setUint32(14, checksum, true);
    d.setUint32(18, content.byteLength, true);
    d.setUint32(22, content.byteLength, true);
    d.setUint16(26, filename.length, true);
    head.set(filename, 30);
    local.push(head, content);
    const c = new Uint8Array(46 + filename.length);
    const v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x0800, true);
    v.setUint32(16, checksum, true);
    v.setUint32(20, content.byteLength, true);
    v.setUint32(24, content.byteLength, true);
    v.setUint16(28, filename.length, true);
    v.setUint32(42, cursor, true);
    c.set(filename, 46);
    central.push(c);
    cursor += head.byteLength + content.byteLength;
  }
  const centralSize = central.reduce((n, x) => n + x.byteLength, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, cursor, true);
  return assemble([...local, ...central, end]);
}
/** Generates Excel-ready review workbook; CSV source provenance is not a live import authorization. */
export function catalogReviewXlsx(csv: string): Uint8Array {
  const rows = parseReviewCsvCells(csv);
  const sheetRows = rows.map((row, index) =>
    '<row r="' + (index + 1) + '">' +
    row.map((value, column) => {
      // Always inlineStr: never emit <f> formulas, numeric floating-point conversion,
      // hyperlinks, macros or ISO dates that Excel might reinterpret.
      return '<c r="' + col(column) + (index + 1) +
        '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlEscape(value) + "</t></is></c>";
    }).join("") + "</row>").join("");
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    sheetRows + "</sheetData></worksheet>";
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Catalog Review" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";
  return zipStored([
    ["[Content_Types].xml", types], ["_rels/.rels", rels],
    ["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", workbookRels],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}
