import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function key(value: string) { return value.trim().replace(/\s+/g, " ").toUpperCase(); }
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

async function analyze(batchId: string, organizationId: string) {
  const [rows, tests, units] = await Promise.all([
    prisma.catalogImportRow.findMany({ where: { batchId, entityType: "REFERENCE_INTERVAL", status: { in: ["VALID", "WARNING"] } }, orderBy: { rowNumber: "asc" } }),
    prisma.labTest.findMany({ where: { organizationId }, include: { defaultUnit: true, components: { include: { unit: true } } } }),
    prisma.unit.findMany({ where: { organizationId } }),
  ]);

  const testMap = new Map<string, typeof tests>();
  for (const test of tests) {
    for (const name of [test.nameEn, test.abbreviation, test.code]) {
      if (!name) continue;
      const k = key(name);
      const list = testMap.get(k) || [];
      if (!list.some((existing) => existing.id === test.id)) list.push(test);
      testMap.set(k, list);
    }
  }
  const unitMap = new Map<string, typeof units[number]>();
  for (const unit of units) {
    unitMap.set(key(unit.code), unit);
    unitMap.set(key(unit.symbol), unit);
  }

  const analyzed = rows.map((row) => {
    const n = object(row.normalizedData);
    const s = object(row.sourceData);
    const testName = text(n.testName || s["test name"] || s.Testname);
    const matches = testMap.get(key(testName)) || [];
    const rangeUnit = text(n.unit || s["test unit"] || s.unit);
    const mappedUnit = rangeUnit ? unitMap.get(key(rangeUnit)) : undefined;
    const mappedSex = sex(n.sex ?? s.sex);
    const from = decimal(n.ageFrom ?? s.agefrom);
    const to = decimal(n.ageTo ?? s.ageto);
    const sourceAgeUnit = n.ageUnit ?? s.ag;
    const mappedAgeUnit = ageUnit(sourceAgeUnit);
    const low = decimal(n.low ?? s.L);
    const high = decimal(n.high ?? s.H);
    const normalText = text(s.Normal);

    let reason = "";
    let test = matches.length === 1 ? matches[0] : undefined;
    if (matches.length === 0) reason = "TEST_NOT_FOUND";
    else if (matches.length > 1) reason = "AMBIGUOUS_TEST_MATCH";
    else if (!mappedUnit) reason = "UNIT_NOT_MAPPED";
    else if (!mappedSex) reason = "SEX_NOT_MAPPED";
    else if ((from !== null || to !== null) && !mappedAgeUnit) reason = "AGE_UNIT_NOT_MAPPED";
    else if (low === null && high === null && !normalText) reason = "EMPTY_REFERENCE_INTERVAL";
    else if (test && test.components.length > 1) reason = "MULTI_COMPONENT_TEST_REQUIRES_REVIEW";
    else if (test?.components.length === 1 && test.components[0].unitId && test.components[0].unitId !== mappedUnit.id) reason = "COMPONENT_UNIT_CONFLICT";
    else if (test?.defaultUnitId && test.defaultUnitId !== mappedUnit.id) reason = "TEST_UNIT_CONFLICT";

    return { row, test, mappedUnit, mappedSex, mappedAgeUnit, from, to, low, high, normalText, reason };
  });

  const safe = analyzed.filter(x => !x.reason);
  const review = analyzed.filter(x => !!x.reason);
  const reasons = review.reduce((a,x) => { a[x.reason] = (a[x.reason] || 0) + 1; return a; }, {} as Record<string,number>);
  return { safe, review, reasons, total: rows.length };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  const { id } = await params;
  const batch = await prisma.catalogImportBatch.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  const analysis = await analyze(batch.id, session.user.organizationId);
  return NextResponse.json({
    total: analysis.total,
    safe: analysis.safe.length,
    review: analysis.review.length,
    reasons: analysis.reasons,
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const batch = await prisma.catalogImportBatch.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });

  const analysis = await analyze(batch.id, session.user.organizationId);
  let imported = 0;
  const componentByTestId = new Map<string, NonNullable<(typeof analysis.safe)[number]["test"]>["components"][number]>();
  for (const item of analysis.safe) {
    if (item.test?.components.length === 1) componentByTestId.set(item.test.id, item.test.components[0]);
  }

  await prisma.$transaction(async (tx) => {
    for (const item of analysis.safe) {
      if (!item.test || !item.mappedUnit || !item.mappedSex) continue;
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
