import { randomBytes } from "node:crypto";
import { isUuid, matchingRequisitionOrder } from "@/lib/doctor-requisition";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  projectF2EffectiveCatalogView, resolveF2EffectiveCatalogViews,
  f2EffectiveCompositeMemberIds,f2EffectiveCompositeMembersAuthorized,
} from "@/lib/catalog-f2-effective-view";
import { PricingConfigurationError, resolvePackagePrice, resolveTestPrice } from "@/lib/pricing";
import { discountApprovalMode, effectiveDiscountLimit } from "@/lib/discount-policy";
import { discountApprovalFingerprint } from "@/lib/discount-approval";
import { invoiceDueDateSnapshot } from "@/lib/accounts-receivable-aging";
import { creditLimitDecision } from "@/lib/client-credit-control";
import { localCalendarDate } from "@/lib/accounts-receivable-aging";
import { resolveTaxRule, taxLineAmounts, type EffectiveTaxRule } from "@/lib/tax-policy";
import { buildOrderItemTatSnapshot, resolveTatPolicy, type TatPriority } from "@/lib/tat";
import { localDateTimeToUtc, normalizeOrderQuestionOptions } from "@/lib/order-questions";
import { parsePromisedReportDelivery } from "@/lib/order-promised-delivery";
import {
  buildSpecimenPlans,
  specimenRequirementEventDetails,
  type SpecimenRequirementInput,
} from "@/lib/specimen-requirement-engine";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class TaxConfigurationChanged extends Error {}
class DoctorRequisitionConversionConflict extends Error {}

class CreditControlError extends Error {
  constructor(
    public readonly code: "credit_limit_exceeded" | "client_credit_state_changed",
    public readonly details: Record<string, string> = {},
  ) {
    super(code);
  }
}

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

function documentNumber(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("orders.create");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36) || session.activeBranchId;
  const patientId = text(body.patientId, 36);
  const sourceId = text(body.sourceId, 36);
  const referrerId = text(body.referrerId, 36) || null;
  const doctorRequisitionId = text(body.doctorRequisitionId, 36) || null;
  if (doctorRequisitionId && !isUuid(doctorRequisitionId))
    return NextResponse.json({error:"invalid_requisition_id"},{status:400});
  const clientId = text(body.clientId, 36) || null;
  const directTestIds = uniqueIds(body.testIds);
  const packageIds = uniqueIds(body.packageIds);
  const priority: TatPriority = ["ROUTINE", "URGENT", "STAT"].includes(body.priority)
    ? body.priority as TatPriority
    : "ROUTINE";
  const clinicalNotes = text(body.clinicalNotes, 5000);
  const diagnosis = text(body.diagnosis, 500);
  const pregnancyInfo = text(body.pregnancyInfo, 500);
  const pregnancyStatus = ["UNKNOWN", "NOT_PREGNANT", "PREGNANT"].includes(body.pregnancyStatus)
    ? body.pregnancyStatus as "UNKNOWN" | "NOT_PREGNANT" | "PREGNANT"
    : "UNKNOWN";
  const gestationalAgeWeeksRaw =
    body.gestationalAgeWeeks === "" || body.gestationalAgeWeeks === null || body.gestationalAgeWeeks === undefined
      ? null
      : Number(body.gestationalAgeWeeks);
  if (
    gestationalAgeWeeksRaw !== null &&
    (!Number.isFinite(gestationalAgeWeeksRaw) || gestationalAgeWeeksRaw < 0)
  ) {
    return NextResponse.json({ error: "invalid_gestational_age" }, { status: 400 });
  }
  if (gestationalAgeWeeksRaw !== null && pregnancyStatus !== "PREGNANT") {
    return NextResponse.json({ error: "gestational_age_requires_pregnant_status" }, { status: 400 });
  }
  const gestationalAgeWeeks = gestationalAgeWeeksRaw === null
    ? null
    : Math.round(gestationalAgeWeeksRaw * 100) / 100;
  const referencePopulationCode = text(body.referencePopulationCode, 80).toUpperCase() || null;
  const fasting = body.fasting === true ? true : body.fasting === false ? false : null;
  const rawRequestedDiscountPercent = Number(body.discountPercent ?? 0);
  if (!Number.isFinite(rawRequestedDiscountPercent) || rawRequestedDiscountPercent < 0 || rawRequestedDiscountPercent > 100) {
    return NextResponse.json({ error: "invalid_discount_percent" }, { status: 400 });
  }
  const requestedDiscountPercent = Math.round(rawRequestedDiscountPercent * 100) / 100;
  const discountReason = text(body.discountReason, 1000);
  const suppliedDiscountApprovalRequestId = text(body.discountApprovalRequestId, 36) || null;

  const requesterDiscountLimit = effectiveDiscountLimit({
    userOverride: session.user.discountLimitPercent,
    roleLimits: session.user.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .map(assignment => assignment.role.discountLimitPercent),
  });
  const requestedApprovalMode = discountApprovalMode({
    requestedPercent: requestedDiscountPercent,
    requesterLimitPercent: requesterDiscountLimit,
  });
  if (requestedApprovalMode === "INVALID") {
    return NextResponse.json({ error: "invalid_discount_percent" }, { status: 400 });
  }
  if (requestedDiscountPercent > 0 && !discountReason) {
    return NextResponse.json({ error: "discount_reason_required" }, { status: 400 });
  }

  if (!branchId || !patientId || !sourceId || (directTestIds.length === 0 && packageIds.length === 0)) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  let discountApprovalMethod: "SELF_LIMIT" | "APPROVAL_WORKFLOW" | null = null;
  let discountApprovedByUserId: string | null = null;
  let discountApprovedAt: Date | null = null;
  let discountApprovalRequestIdToUse: string | null = null;
  if (requestedApprovalMode === "SELF_LIMIT") {
    discountApprovalMethod = "SELF_LIMIT";
    discountApprovedByUserId = session.user.id;
    discountApprovedAt = new Date();
  }

  // A future-effective F2 package membership must become the membership of
  // NEW orders. Previously issued order items continue to retain their own
  // immutable package and pricing snapshots.
  const catalogAsOf = new Date();
  const basePackages = packageIds.length ? await prisma.commercialPackage.findMany({
    where: {
      id: { in: packageIds },
      organizationId: session.user.organizationId,
    },
    include: {
      items: {
        include: { test: { select: { id: true, status: true } } },
        orderBy: { displayOrder: "asc" },
      },
    },
  }) : [];
  if (basePackages.length !== packageIds.length) {
    return NextResponse.json({ error: "one_or_more_packages_not_found" }, { status: 404 });
  }
  const packageOverlays = await resolveF2EffectiveCatalogViews(prisma as Prisma.TransactionClient,{
    organizationId:session.user.organizationId,asOf:catalogAsOf,
    records:basePackages.map(pkg=>({entityType:"PACKAGE" as const,id:pkg.id})),
  });
  const packages = basePackages.map(pkg=>
    projectF2EffectiveCatalogView("PACKAGE",pkg,packageOverlays));
  if(packages.some(pkg=>pkg.status!=="ACTIVE"))
    return NextResponse.json({error:"package_not_active_at_order_time"},{status:409});
  const effectiveMemberships=new Map<string,ReadonlyMap<string,string>>();
  for(const pkg of packages){
    const overlay=packageOverlays.get("PACKAGE:"+pkg.id.toLowerCase());
    if(!overlay)continue;
    const memberIds=f2EffectiveCompositeMemberIds("PACKAGE",[
      {id:pkg.id,items:overlay.items},
    ]);
    if(!memberIds)
      return NextResponse.json({error:"effective_package_membership_invalid"},{status:409});
    effectiveMemberships.set(pkg.id,memberIds);
  }
  const overriddenTestIds=[...new Set([...effectiveMemberships.values()]
    .flatMap(members=>[...members.keys()]))];
  const eligibleTests=overriddenTestIds.length?await prisma.labTest.findMany({
    where:{id:{in:overriddenTestIds},organizationId:session.user.organizationId,
      status:"ACTIVE"},
    select:{id:true,code:true},
  }):[];
  for(const [pkgId,members] of effectiveMemberships){
    const permitted=eligibleTests.filter(test=>members.has(test.id));
    if(!f2EffectiveCompositeMembersAuthorized(members,permitted))
      return NextResponse.json({
        error:"effective_package_membership_scope_changed",packageId:pkgId,
      },{status:409});
  }
  const packageTestOwner = new Map<string, string>();
  for (const pkg of packages) {
    const members=effectiveMemberships.get(pkg.id);
    const entries=members?[...members.keys()].map(testId=>({
      testId,test:{status:"ACTIVE"},
    })):basePackages.find(original=>original.id===pkg.id)!.items;
    for (const item of entries) {
      if (item.test.status !== "ACTIVE") {
        return NextResponse.json({ error: "package_contains_inactive_test", packageCode: pkg.code }, { status: 409 });
      }
      const existingPackageId = packageTestOwner.get(item.testId);
      if (existingPackageId && existingPackageId !== pkg.id) {
        return NextResponse.json({ error: "package_test_overlap", testId: item.testId }, { status: 409 });
      }
      packageTestOwner.set(item.testId, pkg.id);
    }
  }
  const directOverlap = directTestIds.find(testId => packageTestOwner.has(testId));
  if (directOverlap) {
    return NextResponse.json({ error: "package_direct_test_overlap", testId: directOverlap }, { status: 409 });
  }

  const packageTestIds = [...packageTestOwner.keys()];
  const allTestIds = [...directTestIds, ...packageTestIds];
  const orderQuestionAsOf = catalogAsOf;

  const [patient, storedTests, source, referrer, client, orderingBranch] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, patientNumber: true, fullNameEn: true, sexAtBirth: true, dateOfBirth: true, recordedAgeValue: true, recordedAgeUnit: true, recordedAgeAt: true } }),
    prisma.labTest.findMany({
      where: { id: { in: allTestIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: {
        defaultUnit: true,
        specimenType: true,
        container: true,
        branchAvailability: { where: { status: "ACTIVE" } },
        orderQuestions: {
          where: {
            status: "ACTIVE",
            effectiveFrom: { lte: orderQuestionAsOf },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: orderQuestionAsOf } }],
          },
          orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        },
      },
    }),
    prisma.orderSource.findFirst({ where: { id: sourceId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, code: true, category: true } }),
    referrerId ? prisma.referrer.findFirst({ where: { id: referrerId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, clientId: true } }) : null,
    clientId ? prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, paymentTermsDays: true, creditControlVersion: true } }) : null,
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, timezone: true, taxConfigVersion: true } }),
  ]);

  // A signed F2 catalog revision changes the NEW order's frozen test and
  // unit display values. Do not silently snapshot stale base-row metadata.
  // Identity, specimen and department FKs are immutable under F2 planning.
  const testViewRecords=[
    ...storedTests.map(test=>({entityType:"TEST" as const,id:test.id})),
    ...storedTests.filter(test=>test.defaultUnit!==null)
      .map(test=>({entityType:"UNIT" as const,id:test.defaultUnit!.id})),
  ];
  const uniqueViewRecords=[...new Map(testViewRecords.map(entry=>[
    entry.entityType+":"+entry.id,entry,
  ])).values()];
  const orderTestOverlays=await resolveF2EffectiveCatalogViews(
    prisma as Prisma.TransactionClient,{
      organizationId:session.user.organizationId,asOf:catalogAsOf,
      records:uniqueViewRecords,
    },
  );
  const tests=storedTests.map(test=>{
    const effective=projectF2EffectiveCatalogView("TEST",test,orderTestOverlays);
    const unit=test.defaultUnit?
      projectF2EffectiveCatalogView("UNIT",test.defaultUnit,orderTestOverlays):null;
    // Decimal source snapshots use lossless text; the operational order
    // engine expects a Prisma.Decimal instance for specimen volume math.
    const minimumVolume=typeof effective.minimumVolume==="string"?
      new Prisma.Decimal(effective.minimumVolume):effective.minimumVolume;
    return {...effective,minimumVolume,defaultUnit:unit};
  });
  if(tests.some(test=>test.status!=="ACTIVE" ||
      test.defaultUnit?.status==="INACTIVE"))
    return NextResponse.json({error:"test_not_active_at_order_time"},{status:409});

  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  if (tests.length !== allTestIds.length) return NextResponse.json({ error: "one_or_more_tests_not_found" }, { status: 404 });
  if (!source) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  if (referrerId && !referrer) return NextResponse.json({ error: "referrer_not_found" }, { status: 404 });
  if (clientId && !client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  if (!orderingBranch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  const promisedDelivery = parsePromisedReportDelivery(
    body.promisedReportDeliveryLocal, orderingBranch.timezone,
  );
  if (!promisedDelivery.ok) {
    return NextResponse.json({ error: promisedDelivery.error }, {
      status: promisedDelivery.error === "invalid_ordering_branch_timezone" ? 409 : 400,
    });
  }
  const promisedDeliverySnapshot = promisedDelivery.snapshot;

  const answerInput: unknown[] = Array.isArray(body.answers) ? body.answers : [];
  const rawAnswers = answerInput.filter((entry): entry is { questionId: string; value: unknown } =>
    Boolean(entry && typeof entry === "object" && typeof (entry as { questionId?: unknown }).questionId === "string")
  );
  const answerIds = rawAnswers.map(entry => entry.questionId);
  if (new Set(answerIds).size !== answerIds.length) {
    return NextResponse.json({ error: "duplicate_order_question_answer" }, { status: 400 });
  }
  const answerMap = new Map(rawAnswers.map(entry => [entry.questionId, entry.value]));
  const questions = tests.flatMap(test => test.orderQuestions.map(question => ({ question, test })));
  const allowedQuestionIds = new Set(questions.map(entry => entry.question.id));
  if (rawAnswers.some(entry => !allowedQuestionIds.has(entry.questionId))) {
    return NextResponse.json({ error: "order_question_not_applicable" }, { status: 400 });
  }

  const preparedAnswers = new Map<string, {
    answerText: string | null;
    answerNumeric: Prisma.Decimal | null;
    answerBoolean: boolean | null;
    answerDate: Date | null;
    answerDateTime: Date | null;
    answerDateTimeLocalSnapshot: string | null;
    answerTimeZoneSnapshot: string | null;
    selectedOptionSnapshot: string | null;
    selectedOptionCodeSnapshot: string | null;
    selectedOptionTextEnSnapshot: string | null;
    selectedOptionTextArSnapshot: string | null;
  }>();

  const emptyPreparedAnswer = () => ({
    answerText: null,
    answerNumeric: null,
    answerBoolean: null,
    answerDate: null,
    answerDateTime: null,
    answerDateTimeLocalSnapshot: null,
    answerTimeZoneSnapshot: null,
    selectedOptionSnapshot: null,
    selectedOptionCodeSnapshot: null,
    selectedOptionTextEnSnapshot: null,
    selectedOptionTextArSnapshot: null,
  });

  try {
    for (const { question, test } of questions) {
      const raw = answerMap.get(question.id);
      const stringValue = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
      const empty = stringValue === "";
      if (empty) {
        if (question.required) {
          return NextResponse.json({
            error: "required_order_question_missing",
            questionId: question.id,
            questionCode: question.code,
            testCode: test.code,
          }, { status: 400 });
        }
        continue;
      }

      if (question.responseType === "TEXT") {
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          answerText: stringValue.slice(0, 5000),
        });
      } else if (question.responseType === "NUMERIC") {
        const value = new Prisma.Decimal(stringValue);
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          answerNumeric: value,
        });
      } else if (question.responseType === "BOOLEAN") {
        if (!["true","false"].includes(stringValue.toLowerCase())) throw new Error("INVALID_BOOLEAN");
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          answerBoolean: stringValue.toLowerCase() === "true",
        });
      } else if (question.responseType === "DATE") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) throw new Error("INVALID_DATE");
        const value = new Date(stringValue + "T00:00:00.000Z");
        if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== stringValue) throw new Error("INVALID_DATE");
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          answerDate: value,
        });
      } else if (question.responseType === "DATETIME") {
        const value = localDateTimeToUtc(stringValue, orderingBranch.timezone);
        if (!value) throw new Error("INVALID_DATETIME");
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          answerDateTime: value,
          answerDateTimeLocalSnapshot: stringValue.slice(0, 32),
          answerTimeZoneSnapshot: orderingBranch.timezone,
        });
      } else if (question.responseType === "SINGLE_CHOICE") {
        const options = normalizeOrderQuestionOptions(question.options);
        const selected = options.find(option => option.code === stringValue)
          || options.find(option => option.valueEn === stringValue || option.valueAr === stringValue);
        if (!selected) throw new Error("INVALID_CHOICE");
        preparedAnswers.set(question.id, {
          ...emptyPreparedAnswer(),
          selectedOptionSnapshot: selected.valueEn,
          selectedOptionCodeSnapshot: selected.code,
          selectedOptionTextEnSnapshot: selected.valueEn,
          selectedOptionTextArSnapshot: selected.valueAr,
        });
      }
    }
  } catch (error) {
    return NextResponse.json({
      error: "invalid_order_question_answer",
      detail: error instanceof Error ? error.message.toLowerCase() : "invalid_value",
    }, { status: 400 });
  }

  const effectiveClientId = clientId || referrer?.clientId || null;
  const effectiveClient = effectiveClientId
    ? (client?.id === effectiveClientId
      ? client
      : await prisma.client.findFirst({
          where: { id: effectiveClientId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true, paymentTermsDays: true, creditControlVersion: true },
        }))
    : null;
  if (effectiveClientId && !effectiveClient) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  const invoiceIssuedAt = new Date();
  const paymentTermsDaysSnapshot = effectiveClient ? effectiveClient.paymentTermsDays ?? 0 : null;
  const invoiceDueDate = effectiveClient
    ? invoiceDueDateSnapshot(invoiceIssuedAt, orderingBranch.timezone, paymentTermsDaysSnapshot ?? 0)
    : null;
  if (effectiveClient && !invoiceDueDate) {
    return NextResponse.json({ error: "invalid_invoice_due_date" }, { status: 409 });
  }

  const directTestIdSet = new Set(directTestIds);
  const directTests = tests.filter(test => directTestIdSet.has(test.id));

  let directPrices;
  let packagePrices;
  try {
    directPrices = await Promise.all(directTests.map(async test => ({
      test,
      price: await resolveTestPrice(prisma, {
        organizationId: session.user.organizationId,
        branchId,
        sourceId,
        referrerId,
        clientId: effectiveClientId,
        testId: test.id,
      }),
    })));

    packagePrices = await Promise.all(packages.map(async pkg => ({
      package: pkg,
      price: await resolvePackagePrice(prisma, {
        organizationId: session.user.organizationId,
        branchId,
        sourceId,
        referrerId,
        clientId: effectiveClientId,
        packageId: pkg.id,
      }),
    })));
  } catch (error) {
    if (error instanceof PricingConfigurationError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    throw error;
  }

  const missingPrices = directPrices.filter(entry => !entry.price).map(entry => ({
    id: entry.test.id,
    code: entry.test.code,
    name: entry.test.nameEn,
  }));
  if (missingPrices.length > 0) {
    return NextResponse.json({ error: "missing_prices", tests: missingPrices }, { status: 409 });
  }

  const missingPackagePrices = packagePrices.filter(entry => !entry.price).map(entry => ({
    id: entry.package.id,
    code: entry.package.code,
    name: entry.package.nameEn,
  }));
  if (missingPackagePrices.length > 0) {
    return NextResponse.json({ error: "missing_package_prices", packages: missingPackagePrices }, { status: 409 });
  }

  const currencies = [...new Set([
    ...directPrices.map(entry => entry.price!.currency),
    ...packagePrices.map(entry => entry.price!.currency),
  ])];
  if (currencies.length !== 1) {
    return NextResponse.json({ error: "mixed_currencies_not_allowed", currencies }, { status: 409 });
  }
  const currency = currencies[0];
  const directPriceMap = new Map(directPrices.map(entry => [entry.test.id, entry.price!]));
  const packagePriceMap = new Map(packagePrices.map(entry => [entry.package.id, entry.price!]));

  let quoteSubtotal = new Prisma.Decimal(0);
  let quoteDiscountTotal = new Prisma.Decimal(0);
  for (const entry of directPrices) {
    const amount = new Prisma.Decimal(entry.price!.unitPrice);
    quoteSubtotal = quoteSubtotal.add(amount);
    quoteDiscountTotal = quoteDiscountTotal.add(
      new Prisma.Decimal(amount.mul(requestedDiscountPercent).div(100).toFixed(4)),
    );
  }
  for (const entry of packagePrices) {
    const amount = new Prisma.Decimal(entry.price!.unitPrice);
    quoteSubtotal = quoteSubtotal.add(amount);
    quoteDiscountTotal = quoteDiscountTotal.add(
      new Prisma.Decimal(amount.mul(requestedDiscountPercent).div(100).toFixed(4)),
    );
  }
  const localTaxDay = localCalendarDate(invoiceIssuedAt, orderingBranch.timezone);
  if (!localTaxDay) return NextResponse.json({ error: "invalid_tax_date" }, { status: 409 });
  const selectedTaxRules = await prisma.taxRule.findMany({
    where: {
      organizationId: session.user.organizationId,
      effectiveFrom: { lte: new Date(localTaxDay + "T00:00:00.000Z") },
      AND: [
        { OR: [{ branchId }, { branchId: null }] },
        { OR: [
          { testId: { in: directTestIds } },
          { packageId: { in: packageIds } },
        ] },
      ],
    },
  });
  const ruleInputs: EffectiveTaxRule[] = selectedTaxRules.map(rule => ({
    id: rule.id,
    branchId: rule.branchId,
    testId: rule.testId,
    packageId: rule.packageId,
    code: rule.code,
    treatment: rule.treatment,
    priceMode: rule.priceMode,
    ratePercent: rule.ratePercent.toFixed(2),
    effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
  }));
  const taxQuotes = [
    ...directPrices.map(entry => {
      const unitPrice = new Prisma.Decimal(entry.price!.unitPrice);
      const netAfterDiscount = unitPrice.sub(new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4)));
      const rule = resolveTaxRule(ruleInputs, branchId, "TEST", entry.test.id, localTaxDay);
      const amounts = taxLineAmounts({ netAfterDiscount: netAfterDiscount.toFixed(4), rule });
      return { kind: "TEST" as const, id: entry.test.id, rule, amounts };
    }),
    ...packagePrices.map(entry => {
      const unitPrice = new Prisma.Decimal(entry.price!.unitPrice);
      const netAfterDiscount = unitPrice.sub(new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4)));
      const rule = resolveTaxRule(ruleInputs, branchId, "PACKAGE", entry.package.id, localTaxDay);
      const amounts = taxLineAmounts({ netAfterDiscount: netAfterDiscount.toFixed(4), rule });
      return { kind: "PACKAGE" as const, id: entry.package.id, rule, amounts };
    }),
  ];
  if (taxQuotes.some(item => !item.amounts)) return NextResponse.json({ error: "invalid_tax_rule" }, { status: 409 });
  const taxQuoteByService = new Map(taxQuotes.map(item => [item.kind + ":" + item.id, item]));
  const quoteTaxTotal = taxQuotes.reduce((sum, item) => sum.add(item.amounts!.taxAmount), new Prisma.Decimal(0));
  const quoteExclusiveTaxTotal = taxQuotes.reduce((sum, item) => sum.add(item.amounts!.exclusiveTax), new Prisma.Decimal(0));
  const quoteFinalTotal = quoteSubtotal.sub(quoteDiscountTotal).add(quoteExclusiveTaxTotal);
  const pricingFingerprint = discountApprovalFingerprint({
    organizationId: session.user.organizationId,
    branchId,
    patientId,
    sourceId,
    referrerId,
    clientId: effectiveClientId,
    directTestIds,
    packageIds,
    discountPercent: requestedDiscountPercent.toFixed(2),
    discountReason,
    currency,
    tax: taxQuotes.map(item => ({
      kind: item.kind,
      id: item.id,
      ruleId: item.rule?.id || null,
      ratePercent: item.rule?.ratePercent || "0.00",
      treatment: item.rule?.treatment || "NO_RULE",
      priceMode: item.rule?.priceMode || "EXCLUSIVE",
      taxAmount: item.amounts!.taxAmount,
    })),
    pricing: [
      ...directPrices.map(entry => ({
        kind: "TEST" as const,
        id: entry.test.id,
        priceReferenceId: entry.price!.priceListItemId,
        unitPrice: entry.price!.unitPrice.toString(),
      })),
      ...packagePrices.map(entry => ({
        kind: "PACKAGE" as const,
        id: entry.package.id,
        priceReferenceId: entry.price!.priceListPackageItemId,
        unitPrice: entry.price!.unitPrice.toString(),
      })),
    ],
  });

  if (requestedApprovalMode === "APPROVAL_WORKFLOW") {
    const now = new Date();
    await prisma.discountApprovalRequest.updateMany({
      where: {
        organizationId: session.user.organizationId,
        requestedByUserId: session.user.id,
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });

    if (suppliedDiscountApprovalRequestId) {
      const suppliedApproval = await prisma.discountApprovalRequest.findFirst({
        where: {
          id: suppliedDiscountApprovalRequestId,
          organizationId: session.user.organizationId,
          requestedByUserId: session.user.id,
          branchId,
        },
      });
      if (!suppliedApproval) {
        return NextResponse.json({ error: "discount_approval_not_found" }, { status: 409 });
      }
      if (
        suppliedApproval.pricingFingerprint !== pricingFingerprint
        || Number(suppliedApproval.discountPercent.toString()) !== requestedDiscountPercent
        || suppliedApproval.reason !== discountReason
      ) {
        return NextResponse.json({ error: "discount_approval_context_changed" }, { status: 409 });
      }
      if (suppliedApproval.expiresAt <= now || suppliedApproval.status === "EXPIRED") {
        return NextResponse.json({ error: "discount_approval_expired" }, { status: 409 });
      }
      if (suppliedApproval.status === "REJECTED") {
        return NextResponse.json({ error: "discount_approval_rejected" }, { status: 409 });
      }
      if (suppliedApproval.status === "USED") {
        return NextResponse.json({ error: "discount_approval_used" }, { status: 409 });
      }
      if (suppliedApproval.status === "PENDING") {
        return NextResponse.json({
          error: "discount_approval_pending",
          approvalRequestId: suppliedApproval.id,
          expiresAt: suppliedApproval.expiresAt,
        }, { status: 409 });
      }
      if (suppliedApproval.status !== "APPROVED" || !suppliedApproval.approvedByUserId || !suppliedApproval.approvedAt) {
        return NextResponse.json({ error: "discount_approval_invalid" }, { status: 409 });
      }

      discountApprovalMethod = "APPROVAL_WORKFLOW";
      discountApprovedByUserId = suppliedApproval.approvedByUserId;
      discountApprovedAt = suppliedApproval.approvedAt;
      discountApprovalRequestIdToUse = suppliedApproval.id;
    } else {
      let approvalRequest = await prisma.discountApprovalRequest.findFirst({
        where: {
          organizationId: session.user.organizationId,
          branchId,
          requestedByUserId: session.user.id,
          pricingFingerprint,
          status: "PENDING",
          expiresAt: { gt: now },
        },
        orderBy: { requestedAt: "desc" },
      });

      if (!approvalRequest) {
        const expiresAt = new Date(now.getTime() + 60 * 60_000);
        approvalRequest = await prisma.$transaction(async tx => {
          const created = await tx.discountApprovalRequest.create({
            data: {
              organizationId: session.user.organizationId,
              branchId,
              requestedByUserId: session.user.id,
              discountPercent: requestedDiscountPercent.toFixed(2),
              reason: discountReason,
              currency,
              subtotalSnapshot: quoteSubtotal,
              discountTotalSnapshot: quoteDiscountTotal,
              taxTotalSnapshot: quoteTaxTotal,
              finalTotalSnapshot: quoteFinalTotal,
              pricingFingerprint,
              contextSnapshot: {
                patientId,
                patientNumber: patient.patientNumber,
                sourceId,
                sourceCode: source.code,
                referrerId,
                clientId: effectiveClientId,
                directTests: directPrices.map(entry => ({
                  id: entry.test.id,
                  code: entry.test.code,
                  name: entry.test.nameEn,
                  priceListItemId: entry.price!.priceListItemId,
                  unitPrice: entry.price!.unitPrice.toString(),
                })),
                packages: packagePrices.map(entry => ({
                  id: entry.package.id,
                  code: entry.package.code,
                  name: entry.package.nameEn,
                  priceListPackageItemId: entry.price!.priceListPackageItemId,
                  unitPrice: entry.price!.unitPrice.toString(),
                })),
              },
              expiresAt,
            },
          });
          await tx.auditEvent.create({
            data: {
              organizationId: session.user.organizationId,
              branchId,
              actorUserId: session.user.id,
              action: "DISCOUNT_APPROVAL_REQUESTED",
              entityType: "DiscountApprovalRequest",
              entityId: created.id,
              reason: discountReason,
              newValues: {
                discountPercent: requestedDiscountPercent.toFixed(2),
                requesterLimitPercent: requesterDiscountLimit.toFixed(2),
                currency,
                subtotal: quoteSubtotal.toString(),
                discountTotal: quoteDiscountTotal.toString(),
                taxTotal: quoteTaxTotal.toString(),
                finalTotal: quoteFinalTotal.toString(),
                expiresAt,
              },
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });
          return created;
        });
      }

      return NextResponse.json({
        error: "discount_approval_required",
        approvalRequestId: approvalRequest.id,
        requesterLimitPercent: requesterDiscountLimit.toFixed(2),
        discountPercent: requestedDiscountPercent.toFixed(2),
        currency,
        subtotal: quoteSubtotal.toString(),
        discountTotal: quoteDiscountTotal.toString(),
        taxTotal: quoteTaxTotal.toString(),
        total: quoteFinalTotal.toString(),
        expiresAt: approvalRequest.expiresAt,
      }, { status: 409 });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The request is a referral intent, NOT an invoice or laboratory order.
      // Lock it before any financial postings; a concurrent cancellation,
      // decline or duplicate conversion can never create an extra invoice.
      if (doctorRequisitionId) {
        const locked = await tx.$queryRaw<Array<{id:string}>>`
          SELECT id FROM doctor_requisitions
          WHERE id=${doctorRequisitionId}
            AND organization_id=${session.user.organizationId}
          FOR UPDATE
        `;
        if(locked.length!==1)throw new DoctorRequisitionConversionConflict();
        const req=await tx.doctorRequisition.findFirst({
          where:{id:doctorRequisitionId,organizationId:session.user.organizationId,
            branchId,patientId,referrerId:referrerId||undefined,status:"SUBMITTED"},
          include:{items:{select:{testId:true}}},
        });
        if (!req || !referrerId || packageIds.length>0 ||
            !matchingRequisitionOrder({
              patientId,branchId,referrerId,priority,testIds:allTestIds,
              diagnosis:diagnosis||null,clinicalNotes:clinicalNotes||null,
            },{
              patientId:req.patientId,branchId:req.branchId,referrerId:req.referrerId,
              priority:req.priority,testIds:req.items.map(x=>x.testId),
              diagnosis:req.diagnosis,clinicalNotes:req.clinicalNotes,
            }))
          throw new DoctorRequisitionConversionConflict();
      }
      let creditControlSnapshot: Record<string, string | boolean> | null = null;
      if (effectiveClient) {
        // The first database statement in this transaction acquires a client-wide
        // optimistic guard. Competing orders and limit edits must retry instead
        // of consuming the same credit headroom.
        const guarded = await tx.client.updateMany({
          where: {
            id: effectiveClient.id,
            organizationId: session.user.organizationId,
            status: "ACTIVE",
            creditControlVersion: effectiveClient.creditControlVersion,
          },
          data: { creditControlVersion: { increment: 1 } },
        });
        if (guarded.count !== 1) {
          throw new CreditControlError("client_credit_state_changed");
        }

        const policy = await tx.clientCreditPolicy.findUnique({
          where: {
            organizationId_clientId_currency: {
              organizationId: session.user.organizationId,
              clientId: effectiveClient.id,
              currency,
            },
          },
        });
        if (policy) {
          if (policy.mode === "DISABLED") {
            creditControlSnapshot = {
              policyId: policy.id,
              currency,
              mode: "DISABLED",
              limitAmount: policy.limitAmount.toFixed(4),
              decision: "DISABLED",
            };
          } else {
            const exposure = await tx.invoice.aggregate({
              where: {
                organizationId: session.user.organizationId,
                clientId: effectiveClient.id,
                currency,
                status: { not: "VOID" },
                balanceAmount: { gt: 0 },
              },
              _sum: { balanceAmount: true },
            });
            const decision = creditLimitDecision({
              mode: policy.mode,
              limitAmount: policy.limitAmount.toFixed(4),
              exposureBefore: (exposure._sum.balanceAmount ?? new Prisma.Decimal(0)).toFixed(4),
              newInvoiceAmount: quoteFinalTotal.toFixed(4),
            });
            if (!decision) throw new Error("INVALID_CLIENT_CREDIT_DECISION");
            if (decision.decision === "BLOCKED") {
              throw new CreditControlError("credit_limit_exceeded", {
                clientId: effectiveClient.id,
                currency,
                limitAmount: decision.limitAmount,
                exposureBefore: decision.exposureBefore,
                projectedExposure: decision.projectedExposure,
              });
            }
            creditControlSnapshot = { policyId: policy.id, currency, ...decision };
          }
        }
      }

      // Serializes tax rule changes with invoice issuance for this branch.
      const taxGuard = await tx.branch.updateMany({
        where: {
          id: branchId,
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          taxConfigVersion: orderingBranch.taxConfigVersion,
          // A timezone edit during registration must not change the meaning
          // of the staff-entered local promise without notice.
          timezone: orderingBranch.timezone,
        },
        data: { taxConfigVersion: { increment: 1 } },
      });
      if (taxGuard.count !== 1) throw new TaxConfigurationChanged();

      let accessionNumber = documentNumber("ORD");
      while (await tx.labOrder.findUnique({ where: { organizationId_accessionNumber: { organizationId: session.user.organizationId, accessionNumber } } })) {
        accessionNumber = documentNumber("ORD");
      }

      const order = await tx.labOrder.create({
        data: {
          organizationId: session.user.organizationId,
          accessionNumber,
          orderingBranchId: branchId,
          patientId,
          patientSexSnapshot: patient.sexAtBirth,
          patientDobSnapshot: patient.dateOfBirth,
          patientAgeValueSnapshot: patient.recordedAgeValue,
          patientAgeUnitSnapshot: patient.recordedAgeUnit,
          patientAgeRecordedAtSnapshot: patient.recordedAgeAt,
          referrerId,
          clientId: effectiveClientId,
          sourceId,
          priority,
          clinicalNotes: clinicalNotes || null,
          promisedReportDeliveryAtUtc: promisedDeliverySnapshot?.promisedReportDeliveryAtUtc ?? null,
          promisedReportDeliveryLocal: promisedDeliverySnapshot?.promisedReportDeliveryLocal ?? null,
          promisedReportDeliveryTimezone: promisedDeliverySnapshot?.promisedReportDeliveryTimezone ?? null,
          diagnosis: diagnosis || null,
          fasting,
          pregnancyInfo: pregnancyInfo || null,
          pregnancyStatus,
          gestationalAgeWeeks,
          referencePopulationCode,
          createdByUserId: session.user.id,
        },
      });

      if (doctorRequisitionId) {
        const claimed=await tx.doctorRequisition.updateMany({
          where:{id:doctorRequisitionId,organizationId:session.user.organizationId,
            branchId,status:"SUBMITTED",fulfilledOrderId:null},
          data:{status:"FULFILLED",fulfilledOrderId:order.id,
            resolvedAt:new Date(),resolvedByUserId:session.user.id,
            resolutionReason:"Registered through authorized LIS order and billing workflow"},
        });
        if(claimed.count!==1)throw new DoctorRequisitionConversionConflict();
        await tx.auditEvent.create({data:{
          organizationId:session.user.organizationId,branchId,actorUserId:session.user.id,
          action:"DOCTOR_ELECTRONIC_REQUISITION_FULFILLED",
          entityType:"DoctorRequisition",entityId:doctorRequisitionId,
          oldValues:{status:"SUBMITTED"},
          newValues:{status:"FULFILLED",orderId:order.id,accessionNumber,
            selectedTestIds:allTestIds,sourceId,financialPosting:"STANDARD_ORDER_INVOICE"},
          ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "REGISTERED",
          reason: "Initial order registration",
          changedByUserId: session.user.id,
        },
      });

      const createdItems: Array<{
        item: { id: string };
        test: (typeof tests)[number];
        tatSnapshot: ReturnType<typeof buildOrderItemTatSnapshot>;
        unitPrice: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        finalPrice: Prisma.Decimal;
        packageId: string | null;
      }> = [];
      let subtotal = new Prisma.Decimal(0);
      let discountTotal = new Prisma.Decimal(0);
      const createdOrderPackages = new Map<string, {
        id: string;
        package: (typeof packages)[number];
        unitPrice: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        finalPrice: Prisma.Decimal;
        taxQuote: (typeof taxQuotes)[number];
      }>();

      for (const pkg of packages) {
        const price = packagePriceMap.get(pkg.id)!;
        const unitPrice = new Prisma.Decimal(price.unitPrice);
        const discountAmount = new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4));
        const finalPrice = unitPrice.sub(discountAmount);
        const taxQuote = taxQuoteByService.get("PACKAGE:" + pkg.id)!;
        const grossPrice = new Prisma.Decimal(taxQuote.amounts!.lineTotal);
        subtotal = subtotal.add(unitPrice);
        discountTotal = discountTotal.add(discountAmount);
        const orderPackage = await tx.orderPackage.create({
          data: {
            orderId: order.id,
            packageId: pkg.id,
            priceListPackageItemId: price.priceListPackageItemId,
            packageCodeSnapshot: pkg.code,
            packageNameEnSnapshot: pkg.nameEn,
            packageNameArSnapshot: pkg.nameAr,
            unitPriceSnapshot: unitPrice,
            discountAmountSnapshot: discountAmount,
            taxAmountSnapshot: new Prisma.Decimal(taxQuote.amounts!.taxAmount),
            finalPriceSnapshot: grossPrice,
            currency,
          },
        });
        createdOrderPackages.set(pkg.id, { id: orderPackage.id, package: pkg, unitPrice, discountAmount, finalPrice, taxQuote });
      }

      for (const test of tests) {
        const tatPolicy = await resolveTatPolicy(tx, {
          testId: test.id,
          branchId,
          priority,
          at: order.orderedAt,
        });
        const tatSnapshot = buildOrderItemTatSnapshot(
          tatPolicy?.tatMinutes ?? test.tatMinutes,
          order.orderedAt,
          tatPolicy ? {
            source: "SLA_POLICY",
            policyId: tatPolicy.id,
            alertBeforeMinutes: tatPolicy.alertBeforeMinutes,
            escalationAfterMinutes: tatPolicy.escalationAfterMinutes,
            escalationRepeatMinutes: tatPolicy.escalationRepeatMinutes,
            maxEscalationLevel: tatPolicy.maxEscalationLevel,
            escalationPermissionCode: tatPolicy.escalationPermissionCode,
          } : {},
        );
        const packageId = packageTestOwner.get(test.id) || null;
        const directPrice = packageId ? null : directPriceMap.get(test.id);
        if (!packageId && !directPrice) throw new Error("DIRECT_PRICE_RESOLUTION_MISSING");
        const unitPrice = packageId ? new Prisma.Decimal(0) : new Prisma.Decimal(directPrice!.unitPrice);
        const discountAmount = packageId
          ? new Prisma.Decimal(0)
          : new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4));
        const finalPrice = unitPrice.sub(discountAmount);
        const testTax = packageId ? null : taxQuoteByService.get("TEST:" + test.id)!;
        const grossPrice = testTax ? new Prisma.Decimal(testTax.amounts!.lineTotal) : finalPrice;
        if (!packageId) {
          subtotal = subtotal.add(unitPrice);
          discountTotal = discountTotal.add(discountAmount);
        }

        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            testId: test.id,
            performedBranchId: test.branchAvailability.some((availability) => availability.branchId === branchId && availability.performedHere) ? branchId : null,
            priceListItemId: packageId ? null : directPrice!.priceListItemId,
            testCodeSnapshot: test.code,
            testNameEnSnapshot: test.nameEn,
            testNameArSnapshot: test.nameAr,
            unitSnapshot: test.defaultUnit?.symbol || null,
            unitPriceSnapshot: unitPrice,
            discountAmountSnapshot: discountAmount,
            taxAmountSnapshot: testTax ? new Prisma.Decimal(testTax.amounts!.taxAmount) : new Prisma.Decimal(0),
            finalPriceSnapshot: grossPrice,
            currency,
            tatMinutesSnapshot: tatSnapshot.tatMinutesSnapshot,
            tatClockBasisSnapshot: tatSnapshot.tatClockBasisSnapshot,
            tatClockStartedAt: tatSnapshot.tatClockStartedAt,
            tatDueAt: tatSnapshot.tatDueAt,
            tatAlertBeforeMinutesSnapshot: tatSnapshot.tatAlertBeforeMinutesSnapshot,
            tatAlertAt: tatSnapshot.tatAlertAt,
            tatEscalationAfterMinutesSnapshot: tatSnapshot.tatEscalationAfterMinutesSnapshot,
            tatEscalationRepeatMinutesSnapshot: tatSnapshot.tatEscalationRepeatMinutesSnapshot,
            tatMaxEscalationLevelSnapshot: tatSnapshot.tatMaxEscalationLevelSnapshot,
            tatEscalationPermissionCodeSnapshot: tatSnapshot.tatEscalationPermissionCodeSnapshot,
            tatFirstEscalationAt: tatSnapshot.tatFirstEscalationAt,
            tatPolicyId: tatSnapshot.tatPolicyId,
            tatSnapshotSource: tatSnapshot.tatSnapshotSource,
          },
          select: { id: true },
        });

        if (packageId) {
          const orderPackage = createdOrderPackages.get(packageId);
          if (!orderPackage) throw new Error("ORDER_PACKAGE_MISSING");
          await tx.orderPackageItem.create({
            data: { orderPackageId: orderPackage.id, orderItemId: item.id },
          });
        }

        for (const question of test.orderQuestions) {
          const answer = preparedAnswers.get(question.id);
          if (!answer) continue;
          await tx.orderAnswer.create({
            data: {
              organizationId: session.user.organizationId,
              orderId: order.id,
              orderItemId: item.id,
              questionId: question.id,
              questionCodeSnapshot: question.code,
              questionTextEnSnapshot: question.questionEn,
              questionTextArSnapshot: question.questionAr,
              responseTypeSnapshot: question.responseType,
              questionVersionSnapshot: question.version,
              answerText: answer.answerText,
              answerNumeric: answer.answerNumeric,
              answerBoolean: answer.answerBoolean,
              answerDate: answer.answerDate,
              answerDateTime: answer.answerDateTime,
              answerDateTimeLocalSnapshot: answer.answerDateTimeLocalSnapshot,
              answerTimeZoneSnapshot: answer.answerTimeZoneSnapshot,
              selectedOptionSnapshot: answer.selectedOptionSnapshot,
              selectedOptionCodeSnapshot: answer.selectedOptionCodeSnapshot,
              selectedOptionTextEnSnapshot: answer.selectedOptionTextEnSnapshot,
              selectedOptionTextArSnapshot: answer.selectedOptionTextArSnapshot,
              recordedByUserId: session.user.id,
            },
          });
        }

        createdItems.push({ item, test, tatSnapshot, unitPrice, discountAmount, finalPrice: grossPrice, packageId });
      }

      if (discountApprovalRequestIdToUse) {
        const consumed = await tx.discountApprovalRequest.updateMany({
          where: {
            id: discountApprovalRequestIdToUse,
            organizationId: session.user.organizationId,
            requestedByUserId: session.user.id,
            status: "APPROVED",
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            status: "USED",
            usedAt: new Date(),
          },
        });
        if (consumed.count !== 1) throw new Error("DISCOUNT_APPROVAL_NOT_CONSUMABLE");
      }

      const specimenRequirementInputs: SpecimenRequirementInput[] = createdItems.map(entry => ({
        orderItemId: entry.item.id,
        testId: entry.test.id,
        testCode: entry.test.code,
        specimenTypeId: entry.test.specimenTypeId,
        specimenTypeCode: entry.test.specimenType?.code || null,
        specimenTypeNameEn: entry.test.specimenType?.nameEn || null,
        specimenTypeNameAr: entry.test.specimenType?.nameAr || null,
        containerId: entry.test.containerId,
        containerCode: entry.test.container?.code || null,
        containerNameEn: entry.test.container?.nameEn || null,
        containerNameAr: entry.test.container?.nameAr || null,
        minimumVolume: entry.test.minimumVolume?.toFixed(3) || null,
        minimumVolumeUnit: entry.test.minimumVolumeUnit,
        patientPreparation: entry.test.patientPreparation,
        collectionInstructions: entry.test.collectionInstructions,
        storageConditions: entry.test.storageConditions,
        stabilityMinutes: entry.test.stabilityMinutes,
      }));
      const specimenPlans = buildSpecimenPlans(specimenRequirementInputs);
      const createdItemById = new Map(createdItems.map(entry => [entry.item.id, entry] as const));

      let specimenSequence = 1;
      for (const plan of specimenPlans) {
        const group = plan.orderItemIds
          .map(orderItemId => createdItemById.get(orderItemId))
          .filter((entry): entry is (typeof createdItems)[number] => Boolean(entry));
        if (group.length !== plan.orderItemIds.length) throw new Error("SPECIMEN_PLAN_ITEM_MISSING");

        const barcode = `${accessionNumber}-${String(specimenSequence).padStart(2, "0")}`;
        const specimen = await tx.specimen.create({
          data: {
            organizationId: session.user.organizationId,
            orderId: order.id,
            specimenTypeId: plan.specimenTypeId,
            containerId: plan.containerId,
            barcode,
            sequenceNumber: specimenSequence,
            currentBranchId: branchId,
          },
        });

        await tx.specimenOrderItem.createMany({
          data: group.map(entry => ({ specimenId: specimen.id, orderItemId: entry.item.id })),
        });

        await tx.specimenEvent.create({
          data: {
            specimenId: specimen.id,
            eventType: "CREATED",
            branchId,
            actorUserId: session.user.id,
            fromStatus: null,
            toStatus: "PLANNED",
            details: specimenRequirementEventDetails(plan, {
              requirementSource: "ORDER_REGISTRATION_SNAPSHOT",
              capturedAt: order.orderedAt,
              extra: { barcode },
            }),
          },
        });

        specimenSequence++;
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_REQUIREMENTS_SNAPSHOTTED",
          entityType: "LabOrder",
          entityId: order.id,
          newValues: {
            accessionNumber,
            requirementEngineVersion: 2,
            requirementSource: "ORDER_REGISTRATION_SNAPSHOT",
            specimenPlans: specimenPlans.map(plan => ({
              specimenTypeCode: plan.specimenTypeCode,
              containerCode: plan.containerCode,
              requiredVolume: plan.requiredVolume,
              requiredVolumeUnit: plan.requiredVolumeUnit,
              storageConditions: plan.storageConditions,
              stabilityMinutes: plan.stabilityMinutes,
              orderItemIds: plan.orderItemIds,
              testCodes: plan.members.map(member => member.testCode),
            })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      if (!subtotal.equals(quoteSubtotal) || !discountTotal.equals(quoteDiscountTotal)) {
        throw new Error("DISCOUNT_QUOTE_MISMATCH");
      }

      let invoiceNumber = documentNumber("INV");
      while (await tx.invoice.findUnique({ where: { organizationId_invoiceNumber: { organizationId: session.user.organizationId, invoiceNumber } } })) {
        invoiceNumber = documentNumber("INV");
      }

      const finalTotal = subtotal.sub(discountTotal).add(quoteExclusiveTaxTotal);
      if (!finalTotal.equals(quoteFinalTotal)) throw new Error("TAX_QUOTE_MISMATCH");
      const invoice = await tx.invoice.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          orderId: order.id,
          clientId: effectiveClientId,
          invoiceNumber,
          currency,
          subtotal,
          discountTotal,
          discountPercent: requestedDiscountPercent.toFixed(2),
          discountReason: requestedDiscountPercent > 0 ? discountReason : null,
          discountApprovalMethod,
          discountApprovedByUserId,
          discountApprovedAt: requestedDiscountPercent > 0 ? discountApprovedAt : null,
          taxTotal: quoteTaxTotal,
          taxBreakdownSnapshot: taxQuotes.map(item => ({
            kind: item.kind,
            id: item.id,
            ruleId: item.rule?.id || null,
            code: item.rule?.code || null,
            treatment: item.rule?.treatment || "NO_RULE",
            ratePercent: item.rule?.ratePercent || "0.00",
            priceMode: item.rule?.priceMode || "EXCLUSIVE",
            taxableBase: item.amounts!.taxableBase,
            taxAmount: item.amounts!.taxAmount,
            lineTotal: item.amounts!.lineTotal,
          })),
          total: finalTotal,
          paidAmount: new Prisma.Decimal(0),
          balanceAmount: finalTotal,
          creditControlSnapshot: creditControlSnapshot ?? Prisma.DbNull,
          paymentTermsDaysSnapshot,
          dueDate: invoiceDueDate,
          dueDateBasis: effectiveClient ? "ISSUANCE_SNAPSHOT" : null,
          issuedAt: invoiceIssuedAt,
          createdByUserId: session.user.id,
        },
      });

      for (const entry of createdItems) {
        if (entry.packageId) continue;
        await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            orderItemId: entry.item.id,
            description: entry.test.nameEn,
            testCodeSnapshot: entry.test.code,
            testNameEnSnapshot: entry.test.nameEn,
            quantity: new Prisma.Decimal(1),
            unitPrice: entry.unitPrice,
            discountAmount: entry.discountAmount,
            taxAmount: new Prisma.Decimal(taxQuoteByService.get("TEST:" + entry.test.id)!.amounts!.taxAmount),
            taxRuleId: taxQuoteByService.get("TEST:" + entry.test.id)!.rule?.id || null,
            taxCodeSnapshot: taxQuoteByService.get("TEST:" + entry.test.id)!.rule?.code || null,
            taxRateSnapshot: taxQuoteByService.get("TEST:" + entry.test.id)!.rule?.ratePercent || null,
            taxTreatmentSnapshot: taxQuoteByService.get("TEST:" + entry.test.id)!.rule?.treatment || null,
            taxPriceModeSnapshot: taxQuoteByService.get("TEST:" + entry.test.id)!.rule?.priceMode || null,
            lineTotal: entry.finalPrice,
          },
        });
      }

      for (const orderPackage of createdOrderPackages.values()) {
        await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            orderPackageId: orderPackage.id,
            description: orderPackage.package.nameEn,
            testCodeSnapshot: orderPackage.package.code,
            testNameEnSnapshot: orderPackage.package.nameEn,
            quantity: new Prisma.Decimal(1),
            unitPrice: orderPackage.unitPrice,
            discountAmount: orderPackage.discountAmount,
            taxAmount: new Prisma.Decimal(orderPackage.taxQuote.amounts!.taxAmount),
            taxRuleId: orderPackage.taxQuote.rule?.id || null,
            taxCodeSnapshot: orderPackage.taxQuote.rule?.code || null,
            taxRateSnapshot: orderPackage.taxQuote.rule?.ratePercent || null,
            taxTreatmentSnapshot: orderPackage.taxQuote.rule?.treatment || null,
            taxPriceModeSnapshot: orderPackage.taxQuote.rule?.priceMode || null,
            lineTotal: new Prisma.Decimal(orderPackage.taxQuote.amounts!.lineTotal),
          },
        });
      }

      if (requestedDiscountPercent > 0 && discountApprovedByUserId && discountApprovalMethod) {
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: "ORDER_DISCOUNT_APPLIED",
            entityType: "Invoice",
            entityId: invoice.id,
            reason: discountReason,
            newValues: {
              invoiceNumber,
              orderId: order.id,
              requestedByUserId: session.user.id,
              discountPercent: requestedDiscountPercent.toFixed(2),
              originalSubtotal: subtotal.toString(),
              discountTotal: discountTotal.toString(),
              finalTotal: finalTotal.toString(),
              approvalMethod: discountApprovalMethod,
              approvalRequestId: discountApprovalRequestIdToUse,
              approvedByUserId: discountApprovedByUserId,
              approvedAt: discountApprovedAt?.toISOString() || null,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "ORDER_REGISTERED",
          entityType: "LabOrder",
          entityId: order.id,
          newValues: {
            accessionNumber,
            patientId,
            sourceId,
            sourceCode: source.code,
            sourceCategory: source.category,
            referrerId,
            clientId: effectiveClientId,
            priority,
            promisedReportDelivery: promisedDeliverySnapshot ? {
              utc: promisedDeliverySnapshot.promisedReportDeliveryAtUtc.toISOString(),
              local: promisedDeliverySnapshot.promisedReportDeliveryLocal,
              timeZone: promisedDeliverySnapshot.promisedReportDeliveryTimezone,
              origin: "STAFF_ENTERED_AT_REGISTRATION",
            } : null,
            directTestIds,
            packageIds,
            expandedTestIds: allTestIds,
            specimenRequirementSnapshots: specimenPlans.map(plan => ({
              specimenTypeCode: plan.specimenTypeCode,
              containerCode: plan.containerCode,
              requiredVolume: plan.requiredVolume,
              requiredVolumeUnit: plan.requiredVolumeUnit,
              storageConditions: plan.storageConditions,
              stabilityMinutes: plan.stabilityMinutes,
              testCodes: plan.members.map(member => member.testCode),
            })),
            tatSnapshots: createdItems.map(entry => ({
              orderItemId: entry.item.id,
              testId: entry.test.id,
              testCode: entry.test.code,
              tatMinutesSnapshot: entry.tatSnapshot.tatMinutesSnapshot,
              tatClockBasisSnapshot: entry.tatSnapshot.tatClockBasisSnapshot,
              tatClockStartedAt: entry.tatSnapshot.tatClockStartedAt?.toISOString() || null,
              tatDueAt: entry.tatSnapshot.tatDueAt?.toISOString() || null,
              tatAlertAt: entry.tatSnapshot.tatAlertAt?.toISOString() || null,
              tatFirstEscalationAt: entry.tatSnapshot.tatFirstEscalationAt?.toISOString() || null,
              escalationRepeatMinutes: entry.tatSnapshot.tatEscalationRepeatMinutesSnapshot,
              maxEscalationLevel: entry.tatSnapshot.tatMaxEscalationLevelSnapshot,
              escalationPermissionCode: entry.tatSnapshot.tatEscalationPermissionCodeSnapshot,
              tatSnapshotSource: entry.tatSnapshot.tatSnapshotSource,
            })),
            answeredOrderQuestionCodes: questions
              .filter(entry => preparedAnswers.has(entry.question.id))
              .map(entry => entry.question.code),
            invoiceNumber,
            currency,
            subtotal: subtotal.toString(),
            discountPercent: requestedDiscountPercent.toFixed(2),
            discountTotal: discountTotal.toString(),
            discountReason: requestedDiscountPercent > 0 ? discountReason : null,
            discountApprovalMethod,
            discountApprovedByUserId,
            total: finalTotal.toString(),
            paymentTermsDaysSnapshot,
            dueDate: invoiceDueDate?.toISOString().slice(0, 10) || null,
            dueDateBasis: effectiveClient ? "ISSUANCE_SNAPSHOT" : null,
            creditControlSnapshot,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      if (creditControlSnapshot?.decision === "WARN_EXCEEDED") {
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: "CLIENT_CREDIT_LIMIT_WARNING",
            entityType: "Invoice",
            entityId: invoice.id,
            newValues: { clientId: effectiveClientId, invoiceNumber, ...creditControlSnapshot },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }
      return {
        order,
        invoice,
        subtotal: subtotal.toString(),
        discountTotal: discountTotal.toString(),
        total: finalTotal.toString(),
        creditControlSnapshot,
      };
    }, { timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      orderId: result.order.id,
      accessionNumber: result.order.accessionNumber,
      promisedReportDelivery: promisedDeliverySnapshot ? {
        utc: promisedDeliverySnapshot.promisedReportDeliveryAtUtc.toISOString(),
        local: promisedDeliverySnapshot.promisedReportDeliveryLocal,
        timeZone: promisedDeliverySnapshot.promisedReportDeliveryTimezone,
      } : null,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      currency,
      subtotal: result.subtotal,
      discountPercent: requestedDiscountPercent.toFixed(2),
      discountTotal: result.discountTotal,
      taxTotal: result.invoice.taxTotal.toFixed(4),
      total: result.total,
      ...(result.creditControlSnapshot ? { creditControl: result.creditControlSnapshot } : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof DoctorRequisitionConversionConflict) {
      return NextResponse.json({error:"requisition_no_longer_pending_or_context_mismatch"},{status:409});
    }
    if (error instanceof TaxConfigurationChanged) {
      return NextResponse.json({ error: "tax_configuration_changed" }, { status: 409 });
    }
    if (error instanceof CreditControlError) {
      if (error.code === "credit_limit_exceeded") {
        await prisma.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: "CLIENT_CREDIT_LIMIT_BLOCKED",
            entityType: "Client",
            entityId: effectiveClientId || "unassigned",
            newValues: { ...error.details, requestedInvoiceAmount: quoteFinalTotal.toFixed(4) },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }
      return NextResponse.json({ error: error.code, ...error.details }, { status: 409 });
    }
    return NextResponse.json({ error: "order_creation_failed" }, { status: 500 });
  }
}
