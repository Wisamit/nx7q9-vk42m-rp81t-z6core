import type { Prisma } from "../../generated/prisma/client";

export type ImportEntity = "TEST" | "PANEL" | "UNIT" | "CONTAINER" | "REFERENCE_INTERVAL" | "COMPONENT" | "PRICE_LIST_ITEM" | "PRICE_LIST_PACKAGE_ITEM";
export type ImportInputRow = { entityType: ImportEntity; legacyKey?: string; data: Prisma.InputJsonObject };

export const allowedImportEntities = new Set<ImportEntity>(["TEST", "PANEL", "UNIT", "CONTAINER", "REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM"]);

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
  if (row.entityType === "COMPONENT") {
    return {
      testCode: text(d.testCode || d.parentTestCode || d.test).toUpperCase(),
      code: text(d.code || d.componentCode).toUpperCase(),
      nameEn: text(d.nameEn || d.componentName),
      nameAr: text(d.nameAr),
      unitCode: text(d.unitCode || d.unit).toUpperCase(),
      resultType: text(d.resultType).toUpperCase(),
    };
  }
  if (row.entityType === "PRICE_LIST_PACKAGE_ITEM") {
    return {
      priceListCode: text(d.priceListCode).toUpperCase(),
      packageCode: text(d.packageCode).toUpperCase(),
      unitPrice: text(d.unitPrice),
      effectiveFrom: text(d.effectiveFrom),
      effectiveTo: text(d.effectiveTo),
    };
  }
  if (row.entityType === "PRICE_LIST_ITEM") {
    return {
      priceListCode: text(d.priceListCode).toUpperCase(),
      testCode: text(d.testCode).toUpperCase(),
      unitPrice: text(d.unitPrice),
      effectiveFrom: text(d.effectiveFrom),
      effectiveTo: text(d.effectiveTo),
    };
  }
  return {
    testName: text(d.testName || d["test name"]),
    low: d.L ?? d.low ?? null,
    high: d.H ?? d.high ?? null,
    unit: text(d["test unit"] || d.unit),
    sex: text(d.sex).toUpperCase() || "ANY",
    ageFrom: d.ageFrom ?? d.agefrom ?? null,
    ageTo: d.ageTo ?? d.ageto ?? null,
    ageUnit: text(d.ageUnit || d.ag).toUpperCase(),
    normalTextEn: text(d.normalTextEn || d.Normal),
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
  // These entities are review-only. They are never eligible for the existing
  // safe-master commit; clinical and price mapping requires separate approval.
  if (entityType === "COMPONENT") {
    if (!normalized.testCode || !normalized.code || !normalized.nameEn) {
      out.push({ severity: "ERROR", code: "MISSING_COMPONENT_IDENTITY", message: "Parent test code, component code and English name are required." });
    }
    out.push({ severity: "WARNING", code: "COMPONENT_MAPPING_APPROVAL_REQUIRED", message: "Component staged for review only; no live create or update is permitted." });
  }
  if (entityType === "PRICE_LIST_PACKAGE_ITEM") {
    if (!normalized.priceListCode || !normalized.packageCode) {
      out.push({ severity: "ERROR", code: "MISSING_PACKAGE_PRICE_MAPPING",
        message: "Both public price list and package codes are required." });
    }
    if (typeof normalized.unitPrice !== "string" ||
        !/^(?:0|[1-9]\\d{0,13})(?:\\.\\d{1,4})?$/.test(normalized.unitPrice)) {
      out.push({ severity: "ERROR", code: "INVALID_PACKAGE_DECIMAL_PRICE",
        message: "Package prices require an exact non-negative DECIMAL(18,4)." });
    }
    if (typeof normalized.effectiveFrom !== "string" ||
        !/^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$/.test(normalized.effectiveFrom) ||
        !Number.isFinite(Date.parse(normalized.effectiveFrom)) ||
        (normalized.effectiveTo && (typeof normalized.effectiveTo !== "string" ||
          !Number.isFinite(Date.parse(normalized.effectiveTo)) ||
          Date.parse(normalized.effectiveTo) < Date.parse(normalized.effectiveFrom as string)))) {
      out.push({ severity: "ERROR", code: "INVALID_PACKAGE_PRICE_WINDOW",
        message: "Package tariff dates must be exact effective calendar dates." });
    }
    out.push({ severity: "WARNING", code: "PACKAGE_TARIFF_APPROVAL_REQUIRED",
      message: "Review only until separately authorized; draft must remain INACTIVE." });
  }
  if (entityType === "PRICE_LIST_ITEM") {
    if (!normalized.priceListCode || !normalized.testCode) {
      out.push({ severity: "ERROR", code: "MISSING_PRICE_MAPPING", message: "Price-list code and test code must be supplied." });
    }
    if (typeof normalized.unitPrice !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(normalized.unitPrice)) {
      out.push({ severity: "ERROR", code: "INVALID_STAGED_PRICE", message: "Price must be a non-negative decimal with at most four fractional digits." });
    }
    if (typeof normalized.effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(normalized.effectiveFrom)
        || Number.isNaN(new Date(normalized.effectiveFrom).getTime())) {
      out.push({ severity: "ERROR", code: "MISSING_PRICE_EFFECTIVE_DATE", message: "A valid effective-from date is required." });
    }
    if (normalized.effectiveTo && (
      typeof normalized.effectiveTo !== "string" || Number.isNaN(new Date(normalized.effectiveTo).getTime())
      || new Date(normalized.effectiveTo).getTime() < new Date(String(normalized.effectiveFrom)).getTime()
    )) {
      out.push({ severity: "ERROR", code: "INVALID_PRICE_EFFECTIVE_WINDOW", message: "Price effective-to cannot precede effective-from." });
    }
    out.push({ severity: "WARNING", code: "PRICE_APPROVAL_REQUIRED", message: "Price staged for review only; no live pricing change or historical price rewrite is permitted." });
  }
  return out;
}

export function rowValidationStatus(issues: ReturnType<typeof validateImportRow>) {
  return issues.some((issue) => issue.severity === "ERROR") ? "ERROR" as const
    : issues.length ? "WARNING" as const
    : "VALID" as const;
}
