import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope, type ClinicalImportScope } from "@/lib/catalog-clinical-import-scope";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function issueCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" ? [code] : [];
  });
}
function key(value: string) { return value.trim().replace(/\s+/g, " ").toUpperCase(); }
function looseKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}
function unitKey(value: string) {
  return value.trim().toUpperCase().replace(/[µμ]/g, "U").replace(/\s+/g, "").replace(/PER/g, "/").replace(/\.$/, "");
}
function canonicalUnitKey(value: string) {
  return unitKey(value)
    .replace(/^GM\//, "G/")
    .replace(/^MCG\//, "UG/")
    .replace(/^ΜG\//, "UG/")
    .replace(/\^2/g, "2");
}
function clinicalAliasKeys(value: string) {
  const source = looseKey(value);
  const groups: string[][] = [
    ["PCO2", "PARTIALPRESSURECARBONDIOXIDE", "CARBONDIOXIDEPARTIALPRESSURE"],
    ["PO2", "PARTIALPRESSUREOXYGEN", "OXYGENPARTIALPRESSURE"],
    ["ROSSA", "SSARO", "ANTISSA", "ANTIROSSA", "ROSSA"],
    ["FPDS", "FDP", "FIBRINDEGRADATIONPRODUCTS", "FIBRINDEGRADATIONPRODUCT"],
  ];
  const group = groups.find((items) => items.includes(source));
  return group || [];
}
function bigrams(value: string) {
  const normalized = looseKey(value);
  const result: string[] = [];
  for (let i = 0; i < normalized.length - 1; i++) result.push(normalized.slice(i, i + 2));
  return result;
}
function similarity(a: string, b: string) {
  const left = looseKey(a);
  const right = looseKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return Math.min(0.96, 0.72 + ratio * 0.24);
  }
  const aPairs = bigrams(a);
  const bPairs = bigrams(b);
  if (!aPairs.length || !bPairs.length) return 0;
  const pool = [...bPairs];
  let intersection = 0;
  for (const pair of aPairs) {
    const index = pool.indexOf(pair);
    if (index >= 0) {
      intersection++;
      pool.splice(index, 1);
    }
  }
  return (2 * intersection) / (aPairs.length + bPairs.length);
}
function rankedTestCandidates(source: string, tests: Array<{ id: string; code: string; nameEn: string; nameAr: string | null; abbreviation: string | null }>) {
  return tests
    .map((test) => ({
      id: test.id,
      code: test.code,
      nameEn: test.nameEn,
      nameAr: test.nameAr,
      score: Math.round(Math.max(
        similarity(source, test.nameEn),
        similarity(source, test.code),
        test.abbreviation ? similarity(source, test.abbreviation) : 0,
      ) * 100),
    }))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || a.nameEn.localeCompare(b.nameEn))
    .slice(0, 5);
}
function rankedUnitCandidates(source: string, units: Array<{ id: string; code: string; symbol: string }>) {
  return units
    .map((unit) => ({
      id: unit.id,
      code: unit.code,
      symbol: unit.symbol,
      score: Math.round(Math.max(
        similarity(unitKey(source), unitKey(unit.symbol)),
        similarity(unitKey(source), unitKey(unit.code)),
      ) * 100),
    }))
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, 5);
}
function decimal(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}
function sex(value: unknown): "ANY" | "MALE" | "FEMALE" | null {
  const v = text(value).toUpperCase();
  if (!v || ["ANY","BOTH","ALL","M/F","MF"].includes(v)) return "ANY";
  if (["M","MALE"].includes(v)) return "MALE";
  if (["F","FEMALE"].includes(v)) return "FEMALE";
  return null;
}
function ageUnit(value: unknown): "DAY" | "WEEK" | "MONTH" | "YEAR" | null {
  const v = text(value).toUpperCase().replace(/S$/,"");
  if (!v) return null;
  if (["D","DAY"].includes(v)) return "DAY";
  if (["W","WK","WEEK"].includes(v)) return "WEEK";
  if (["M","MO","MONTH"].includes(v)) return "MONTH";
  if (["Y","YR","YEAR"].includes(v)) return "YEAR";
  return null;
}

async function analyze(batchId: string, organizationId: string, scope: ClinicalImportScope) {
  const [rows, tests, units, legacyTests, legacyUnits, reviewedMappings] = await Promise.all([
    prisma.catalogImportRow.findMany({ where: { batchId, entityType: "REFERENCE_INTERVAL", status: { in: ["VALID", "WARNING"] } }, orderBy: { rowNumber: "asc" } }),
    prisma.labTest.findMany({ where: clinicalImportTestWhere(scope), include: { department: true, defaultUnit: true, components: { include: { unit: true } } } }),
    prisma.unit.findMany({ where: { organizationId } }),
    prisma.catalogImportRow.findMany({ where: { batchId, entityType: "TEST", importedEntityId: { not: null } }, select: { importedEntityId: true, legacyKey: true, sourceData: true, normalizedData: true } }),
    prisma.catalogImportRow.findMany({ where: { batchId, entityType: "UNIT", importedEntityId: { not: null } }, select: { importedEntityId: true, legacyKey: true, sourceData: true, normalizedData: true } }),
    prisma.catalogImportMapping.findMany({ where: { organizationId }, select: { mappingType: true, normalizedSourceValue: true, targetTestId: true, targetUnitId: true } }),
  ]);

  const testMap = new Map<string, typeof tests>();
  function addTestAlias(alias: string, test: typeof tests[number]) {
    for (const k of [key(alias), looseKey(alias), ...clinicalAliasKeys(alias)]) {
      if (!k) continue;
      const list = testMap.get(k) || [];
      if (!list.some((existing) => existing.id === test.id)) list.push(test);
      testMap.set(k, list);
    }
  }
  for (const test of tests) {
    for (const name of [test.nameEn, test.abbreviation, test.code]) if (name) addTestAlias(name, test);
  }
  const testById = new Map(tests.map((test) => [test.id, test]));
  for (const row of legacyTests) {
    const test = row.importedEntityId ? testById.get(row.importedEntityId) : undefined;
    if (!test) continue;
    const source = object(row.sourceData);
    const normalized = object(row.normalizedData);
    for (const alias of [
      text(normalized.nameEn), text(normalized.code), text(source.Testname), text(source["test name"]),
      text(source.Abrev), text(source.Abre), text(row.legacyKey?.split("|").pop())
    ]) if (alias) addTestAlias(alias, test);
  }

  const unitMap = new Map<string, typeof units[number]>();
  function addUnitAlias(alias: string, unit: typeof units[number]) {
    for (const k of [key(alias), unitKey(alias), canonicalUnitKey(alias)]) if (k) unitMap.set(k, unit);
  }
  for (const unit of units) {
    addUnitAlias(unit.code, unit);
    addUnitAlias(unit.symbol, unit);
  }
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  for (const row of legacyUnits) {
    const unit = row.importedEntityId ? unitById.get(row.importedEntityId) : undefined;
    if (!unit) continue;
    const source = object(row.sourceData);
    const normalized = object(row.normalizedData);
    for (const alias of [text(normalized.code), text(normalized.symbol), text(source.unit), text(source.Unit), text(row.legacyKey)]) {
      if (alias) addUnitAlias(alias, unit);
    }
  }

  const reviewedTestAliases = new Map<string, typeof tests[number]>();
  const reviewedUnitAliases = new Map<string, typeof units[number]>();
  for (const mapping of reviewedMappings) {
    if (mapping.mappingType === "TEST_ALIAS" && mapping.targetTestId) {
      const target = testById.get(mapping.targetTestId);
      if (target) reviewedTestAliases.set(mapping.normalizedSourceValue, target);
    }
    if (mapping.mappingType === "UNIT_ALIAS" && mapping.targetUnitId) {
      const target = unitById.get(mapping.targetUnitId);
      if (target) reviewedUnitAliases.set(mapping.normalizedSourceValue, target);
    }
  }

  const legacyUnitByTestId = new Map<string, typeof units[number]>();
  for (const row of legacyTests) {
    if (!row.importedEntityId) continue;
    const source = object(row.sourceData);
    const normalized = object(row.normalizedData);
    const rawUnit = text(normalized.unit || source.unit || source.Unit || source["test unit"]);
    if (!rawUnit) continue;
    const mapped = reviewedUnitAliases.get(unitKey(rawUnit))
      || unitMap.get(key(rawUnit))
      || unitMap.get(unitKey(rawUnit))
      || unitMap.get(canonicalUnitKey(rawUnit));
    if (mapped) legacyUnitByTestId.set(row.importedEntityId, mapped);
  }

  const analyzed = rows.map((row) => {
    const n = object(row.normalizedData);
    const s = object(row.sourceData);
    const testName = text(n.testName || s["test name"] || s.Testname);
    const reviewedTest = reviewedTestAliases.get(looseKey(testName));
    const aliasMatches = clinicalAliasKeys(testName).flatMap((alias) => testMap.get(alias) || []);
    const dedupedAliasMatches = aliasMatches.filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index);
    const exactMatches = reviewedTest ? [reviewedTest] : (testMap.get(key(testName)) || []);
    const looseMatches = reviewedTest ? [reviewedTest] : (testMap.get(looseKey(testName)) || []);
    const matches = exactMatches.length ? exactMatches : looseMatches.length ? looseMatches : dedupedAliasMatches;
    const rangeUnit = text(n.unit || s["test unit"] || s.unit);
    const reviewedUnit = rangeUnit ? reviewedUnitAliases.get(unitKey(rangeUnit)) : undefined;
    const explicitMappedUnit = rangeUnit ? (reviewedUnit || unitMap.get(key(rangeUnit)) || unitMap.get(unitKey(rangeUnit)) || unitMap.get(canonicalUnitKey(rangeUnit))) : undefined;
    const mappedSex = sex(n.sex ?? s.sex);
    const from = decimal(n.ageFrom ?? s.agefrom);
    const to = decimal(n.ageTo ?? s.ageto);
    const sourceAgeUnit = n.ageUnit ?? s.ag;
    const mappedAgeUnit = ageUnit(sourceAgeUnit);
    const low = decimal(n.low ?? s.L);
    const high = decimal(n.high ?? s.H);
    const normalText = text(s.Normal);

    let reason = "";
    const test = matches.length === 1 ? matches[0] : undefined;
    const componentUnit = test?.components.length === 1 ? test.components[0].unit : undefined;
    const legacyTestUnit = test ? legacyUnitByTestId.get(test.id) : undefined;
    const trustedTestUnit = test?.defaultUnit || componentUnit || legacyTestUnit;
    const equivalentExplicitFallback = rangeUnit && trustedTestUnit &&
      [trustedTestUnit.symbol, trustedTestUnit.code].some((candidate) => canonicalUnitKey(candidate) === canonicalUnitKey(rangeUnit))
      ? trustedTestUnit : undefined;
    const mappedUnit = explicitMappedUnit || equivalentExplicitFallback || (!rangeUnit ? trustedTestUnit : undefined);
    if (matches.length === 0) reason = "TEST_NOT_FOUND";
    else if (matches.length > 1) reason = "AMBIGUOUS_TEST_MATCH";
    else if (!mappedUnit) reason = rangeUnit ? "UNIT_NOT_MAPPED" : "UNIT_MISSING_NO_TEST_DEFAULT";
    else if (!mappedSex) reason = "SEX_NOT_MAPPED";
    else if ((from !== null || to !== null) && !mappedAgeUnit) reason = "AGE_UNIT_NOT_MAPPED";
    else if (low === null && high === null && !normalText) reason = "EMPTY_REFERENCE_INTERVAL";
    else if (test && test.components.length > 1) reason = "MULTI_COMPONENT_TEST_REQUIRES_REVIEW";
    else if (test?.components.length === 1 && test.components[0].unitId && test.components[0].unitId !== mappedUnit.id) reason = "COMPONENT_UNIT_CONFLICT";
    else if (test?.defaultUnitId && test.defaultUnitId !== mappedUnit.id) reason = "TEST_UNIT_CONFLICT";

    return { row, test, testName, rangeUnit, mappedUnit, mappedSex, mappedAgeUnit, from, to, low, high, normalText, reason };
  });

  const safe = analyzed.filter(x => !x.reason);
  const review = analyzed.filter(x => !!x.reason);
  const reasons = review.reduce((a,x) => { a[x.reason] = (a[x.reason] || 0) + 1; return a; }, {} as Record<string,number>);
  return { safe, review, reasons, total: rows.length, tests, units };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  const { id } = await params;
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId,
    activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch,
    branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
  const batch = await prisma.catalogImportBatch.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  const analysis = await analyze(batch.id, session.user.organizationId, scope);
  const generatedTestWarnings = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "TEST", status: "WARNING" },
    select: { validationIssues: true },
  });
  const generatedTestsRemaining = generatedTestWarnings.filter((row) => {
    const codes = issueCodes(row.validationIssues);
    return codes.length === 1 && codes[0] === "GENERATED_TEST_CODE";
  }).length;
  const topValues = (reason: string, pick: (item: typeof analysis.review[number]) => string) => {
    const counts = new Map<string, number>();
    for (const item of analysis.review.filter((row) => row.reason === reason)) {
      const value = pick(item) || "(blank)";
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([value, count]) => ({ value, count }));
  };

  const unmatchedTests = topValues("TEST_NOT_FOUND", (item) => item.testName).map((item) => {
    const candidates = rankedTestCandidates(item.value, analysis.tests);
    return { ...item, suggestion: candidates[0] && candidates[0].score >= 58 ? candidates[0] : null, candidates };
  });
  const unmappedUnits = topValues("UNIT_NOT_MAPPED", (item) => item.rangeUnit).map((item) => {
    const candidates = rankedUnitCandidates(item.value, analysis.units);
    return { ...item, suggestion: candidates[0] && candidates[0].score >= 55 ? candidates[0] : null, candidates };
  });

  return NextResponse.json({
    total: analysis.total,
    safe: analysis.safe.length,
    review: analysis.review.length,
    reasons: analysis.reasons,
    generatedTestsRemaining,
    details: {
      unmatchedTests,
      unmappedUnits,
      unitConflicts: topValues("TEST_UNIT_CONFLICT", (item) => `${item.testName} | ${item.rangeUnit}`),
      emptyIntervals: topValues("EMPTY_REFERENCE_INTERVAL", (item) => item.testName),
    },
    testOptions: analysis.tests.map((test) => ({ id: test.id, code: test.code, nameEn: test.nameEn, nameAr: test.nameAr })).sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
    unitOptions: analysis.units.map((unit) => ({ id: unit.id, code: unit.code, symbol: unit.symbol })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId,
    activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch,
    branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
  const batch = await prisma.catalogImportBatch.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if (batch.sourceType === "CSV_REVIEW") return NextResponse.json({ error: "csv_review_is_not_clinical_import" }, { status: 409 });

  const analysis = await analyze(batch.id, session.user.organizationId, scope);
  let imported = 0;
  const componentByTestId = new Map<string, NonNullable<(typeof analysis.safe)[number]["test"]>["components"][number]>();
  for (const item of analysis.safe) {
    if (item.test?.components.length === 1) componentByTestId.set(item.test.id, item.test.components[0]);
  }

  await prisma.$transaction(async (tx) => {
    for (const item of analysis.safe) {
      if (!item.test || !item.mappedUnit || !item.mappedSex) continue;
      // Claim the *source row* before creating any clinical definition.
      // updateMany is a conditional InnoDB UPDATE: an overlapping request
      // sees zero claimed rows after the first commits. A transaction error
      // rolls back both the claim and the clinical changes.
      // Re-authorize the performing test within the transaction; preview data
      // is not a permission token and may become stale before a POST executes.
      const currentTest = await tx.labTest.findFirst({
        where: { ...clinicalImportTestWhere(scope), id: item.test.id, status: "ACTIVE" },
        select: { id: true, defaultUnitId: true },
      });
      if (!currentTest) throw new Error("clinical_import_test_scope_changed");
      const claim = await tx.catalogImportRow.updateMany({
        where: {
          id: item.row.id, batchId: batch.id,
          status: { in: ["VALID", "WARNING"] }, importedEntityId: null,
        },
        data: { status: "IMPORTED" },
      });
      if (claim.count !== 1) continue;
      if (!currentTest.defaultUnitId && item.mappedUnit.id) {
        await tx.labTest.update({ where: { id: currentTest.id }, data: { defaultUnitId: item.mappedUnit.id } });
      }

      let component = componentByTestId.get(item.test.id);
      if (!component) {
        component = await tx.testComponent.create({
          data: {
            testId: item.test.id,
            code: item.test.code,
            nameEn: item.test.nameEn,
            nameAr: item.test.nameAr,
            unitId: item.mappedUnit.id,
            resultType: item.test.resultType,
            decimalPrecision: item.test.decimalPrecision,
            displayOrder: 0,
          },
          include: { unit: true },
        });
        componentByTestId.set(item.test.id, component);
      }

      const interval = await tx.referenceInterval.create({
        data: {
          componentId: component.id,
          sex: item.mappedSex,
          ageFrom: item.from,
          ageTo: item.to,
          ageUnit: item.mappedAgeUnit,
          lowValue: item.low,
          highValue: item.high,
          normalTextEn: item.normalText || null,
          effectiveFrom: new Date(),
          status: "INACTIVE",
          approvalStatus: "DRAFT",
          createdByUserId: session.user.id,
          source: "Legacy Family Lab MDB / normal",
          notes: "Migrated through validated legacy reference-range import; pending clinical approval before activation.",
        },
      });
      await tx.catalogImportRow.update({
        where: { id: item.row.id },
        data: { status: "IMPORTED", importedEntityId: interval.id },
      });
      imported++;
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "LEGACY_REFERENCE_INTERVALS_IMPORTED",
        entityType: "CatalogImportBatch",
        entityId: batch.id,
        newValues: { total: analysis.total, imported, reviewRequired: analysis.review.length, reasons: analysis.reasons },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }, { timeout: 60000 });

  return NextResponse.json({ status: "ok", total: analysis.total, imported, review: analysis.review.length, reasons: analysis.reasons });
}
