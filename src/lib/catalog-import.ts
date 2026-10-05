import type { Prisma } from "../../generated/prisma/client";

export type ImportEntity = "TEST" | "PANEL" | "UNIT" | "CONTAINER" | "REFERENCE_INTERVAL";
export type ImportInputRow = { entityType: ImportEntity; legacyKey?: string; data: Prisma.InputJsonObject };

export const allowedImportEntities = new Set<ImportEntity>(["TEST", "PANEL", "UNIT", "CONTAINER", "REFERENCE_INTERVAL"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function generatedTestCode(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase()
    .slice(0, 72);
  return slug || "";
}

export function normalizeImportRow(row: ImportInputRow): Prisma.InputJsonObject {
  const d = row.data;
  if (row.entityType === "TEST") {
    const nameEn = text(d.nameEn || d.Testname || d["test name"]);
    const sourceCode = text(d.code || d.Abrev || d.Abre);
    return {
      code: sourceCode || generatedTestCode(nameEn),
      generatedCode: !sourceCode && !!nameEn,
      nameEn,
      unit: text(d.unit),
      assay: text(d.Assay),
      collection: text(d.Collection),
      panel: text(d.Panel),
    };
  }
  if (row.entityType === "UNIT") {
    return { code: text(d.code || d.unit || d.Unit), symbol: text(d.symbol || d.unit || d.Unit) };
  }
  if (row.entityType === "PANEL") {
    const nameEn = text(d.nameEn || d.profilname);
    return { code: text(d.code || d.profilname).replace(/\s+/g, "_").toUpperCase(), nameEn };
  }
  if (row.entityType === "CONTAINER") {
    const nameEn = text(d.nameEn || d.name);
    return { code: text(d.code || d.name).replace(/\s+/g, "_").toUpperCase(), nameEn };
  }
  return {
    testName: text(d.testName || d["test name"]),
    low: d.L ?? d.low ?? null,
    high: d.H ?? d.high ?? null,
    unit: text(d["test unit"] || d.unit),
    sex: text(d.sex).toUpperCase() || "ANY",
    ageFrom: d.agefrom ?? null,
    ageTo: d.ageto ?? null,
    ageUnit: text(d.ag).toUpperCase(),
  };
}

export function validateImportRow(entityType: ImportEntity, normalized: Prisma.InputJsonObject) {
  const out: { severity: "ERROR" | "WARNING"; code: string; message: string }[] = [];

  if (entityType === "TEST") {
    if (!normalized.nameEn) {
      out.push({ severity: "ERROR", code: "MISSING_TEST_NAME", message: "Test name is required." });
    } else if (!normalized.code) {
      out.push({ severity: "ERROR", code: "MISSING_TEST_CODE", message: "A safe test code could not be generated." });
    } else if (normalized.generatedCode === true) {
      out.push({ severity: "WARNING", code: "GENERATED_TEST_CODE", message: "Legacy abbreviation is missing; a deterministic code was generated from the test name and should be reviewed." });
    }
  }

  if (["UNIT", "PANEL", "CONTAINER"].includes(entityType) &&
      (!normalized.code || (!normalized.nameEn && entityType !== "UNIT"))) {
    out.push({ severity: "ERROR", code: "MISSING_MASTER_IDENTITY", message: "Code/name could not be normalized." });
  }

  if (entityType === "REFERENCE_INTERVAL" && !normalized.testName) {
    out.push({ severity: "ERROR", code: "MISSING_RANGE_TEST", message: "Reference interval has no test name." });
  }
  if (entityType === "REFERENCE_INTERVAL" && !normalized.unit) {
    out.push({ severity: "WARNING", code: "MISSING_RANGE_UNIT", message: "Reference interval has no unit and requires review." });
  }
  return out;
}

export function rowValidationStatus(issues: ReturnType<typeof validateImportRow>) {
  return issues.some((issue) => issue.severity === "ERROR") ? "ERROR" as const
    : issues.length ? "WARNING" as const
    : "VALID" as const;
}
