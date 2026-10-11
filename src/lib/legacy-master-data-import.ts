import { createHash } from "node:crypto";

export type LegacyMasterKind = "REFERRER" | "SOURCE" | "ORGANISM" | "ANTIBIOTIC";

export type LegacyMasterRow = {
  rowNumber: number;
  code: string;
  nameEn: string;
  nameAr: string | null;
  category: string | null;
  type: "PHYSICIAN" | "CLINIC" | "HOSPITAL" | "OTHER" | null;
  drugClass: string | null;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
};

export class LegacyMasterImportError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export const LEGACY_MASTER_COLUMNS: Record<LegacyMasterKind, readonly string[]> = {
  REFERRER: ["code", "name_en", "name_ar", "type", "phone", "email", "license_number"],
  SOURCE: ["code", "name_en", "name_ar", "category"],
  ORGANISM: ["code", "name_en", "name_ar", "category"],
  ANTIBIOTIC: ["code", "name_en", "name_ar", "drug_class"],
};

export const LEGACY_MASTER_MAX_ROWS = 200;
export const LEGACY_MASTER_MAX_BYTES = 65_536;

/** RFC4180-compatible field quoting (including escaped quotes and newlines). */
function csvMatrix(source: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let atFieldStart = true;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (!atFieldStart || afterQuote) throw new LegacyMasterImportError("malformed_csv_quote");
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw new LegacyMasterImportError("malformed_csv_quote");
    }
    if (char === ",") {
      cells.push(field.trim());
      field = "";
      afterQuote = false;
      atFieldStart = true;
      continue;
    }
    if (char === "\n" || char === "\r") {
      cells.push(field.trim());
      if (cells.some(value => value !== "")) rows.push(cells);
      cells = [];
      field = "";
      afterQuote = false;
      atFieldStart = true;
      if (char === "\r" && source[i + 1] === "\n") i++;
      if (rows.length > LEGACY_MASTER_MAX_ROWS + 1) {
        throw new LegacyMasterImportError("too_many_rows");
      }
      continue;
    }
    field += char;
    atFieldStart = false;
  }
  if (quoted) throw new LegacyMasterImportError("unterminated_csv_quote");
  cells.push(field.trim());
  if (cells.some(value => value !== "")) rows.push(cells);
  return rows;
}

/** Never silently truncate, guess a referrer type or overwrite existing codes. */
export function parseLegacyMasterCsv(kind: LegacyMasterKind, csv: string): LegacyMasterRow[] {
  if (!(kind in LEGACY_MASTER_COLUMNS)) throw new LegacyMasterImportError("unsupported_master_kind");
  if (Buffer.byteLength(csv, "utf8") > LEGACY_MASTER_MAX_BYTES) {
    throw new LegacyMasterImportError("csv_too_large");
  }
  const rows = csvMatrix(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new LegacyMasterImportError("no_import_rows");
  if (rows.length - 1 > LEGACY_MASTER_MAX_ROWS) throw new LegacyMasterImportError("too_many_rows");
  const headers = LEGACY_MASTER_COLUMNS[kind];
  if (rows[0].length !== headers.length || headers.some((key, i) =>
    rows[0][i]?.toLowerCase() !== key)) {
    throw new LegacyMasterImportError("header_mismatch");
  }
  const seen = new Set<string>();
  return rows.slice(1).map((fields, i) => {
    const rowNumber = i + 2;
    if (fields.length !== headers.length) {
      throw new LegacyMasterImportError("column_count_mismatch_row_" + rowNumber);
    }
    const data = Object.fromEntries(headers.map((header, index) => [header, fields[index]]));
    const code = data.code.toUpperCase();
    const nameEn = data.name_en;
    const nameAr = data.name_ar || null;
    if (!/^[A-Z0-9._-]{1,80}$/.test(code) ||
      code.length > (kind === "REFERRER" || kind === "SOURCE" ? 60 : 80)) {
      throw new LegacyMasterImportError("invalid_code_row_" + rowNumber);
    }
    if (!nameEn || nameEn.length > 220 || (nameAr?.length || 0) > 220 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(nameEn + (nameAr || ""))) {
      throw new LegacyMasterImportError("invalid_name_row_" + rowNumber);
    }
    if (seen.has(code)) throw new LegacyMasterImportError("duplicate_code_in_csv_row_" + rowNumber);
    seen.add(code);
    const type = kind === "REFERRER" ? data.type.toUpperCase() : null;
    if (kind === "REFERRER" &&
      !["PHYSICIAN", "CLINIC", "HOSPITAL", "OTHER"].includes(type!)) {
      throw new LegacyMasterImportError("invalid_referrer_type_row_" + rowNumber);
    }
    const category = kind === "SOURCE" || kind === "ORGANISM" ? (data.category || null) : null;
    if (kind === "SOURCE" && !category) {
      throw new LegacyMasterImportError("source_category_required_row_" + rowNumber);
    }
    if ((category?.length || 0) > (kind === "SOURCE" ? 80 : 120) ||
      (data.drug_class?.length || 0) > 150 ||
      (data.phone?.length || 0) > 50 ||
      (data.email?.length || 0) > 191 ||
      (data.license_number?.length || 0) > 100) {
      throw new LegacyMasterImportError("invalid_detail_row_" + rowNumber);
    }
    const email = kind === "REFERRER" && data.email ? data.email.toLowerCase() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new LegacyMasterImportError("invalid_email_row_" + rowNumber);
    }
    return {
      rowNumber, code, nameEn, nameAr,
      category,
      type: type as LegacyMasterRow["type"],
      drugClass: kind === "ANTIBIOTIC" ? data.drug_class || null : null,
      phone: kind === "REFERRER" ? data.phone || null : null,
      email,
      licenseNumber: kind === "REFERRER" ? data.license_number || null : null,
    };
  });
}

export function legacyMasterFingerprint(
  organizationId: string,
  kind: LegacyMasterKind,
  rows: readonly LegacyMasterRow[],
): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1, organizationId, kind, rows,
  })).digest("hex");
}
