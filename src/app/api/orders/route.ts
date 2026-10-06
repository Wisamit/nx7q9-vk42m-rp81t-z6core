import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolvePackagePrice, resolveTestPrice } from "@/lib/pricing";
import { discountApprovalMode, effectiveDiscountLimit } from "@/lib/discount-policy";
import { verifyDiscountApprover } from "@/lib/discount-approval";
import { checkRateLimit } from "@/lib/rate-limit";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
  const clientId = text(body.clientId, 36) || null;
  const directTestIds = uniqueIds(body.testIds);
  const packageIds = uniqueIds(body.packageIds);
  const priority = ["ROUTINE", "URGENT", "STAT"].includes(body.priority) ? body.priority : "ROUTINE";
  const clinicalNotes = text(body.clinicalNotes, 5000);
  const diagnosis = text(body.diagnosis, 500);
  const pregnancyInfo = text(body.pregnancyInfo, 500);
  const fasting = body.fasting === true ? true : body.fasting === false ? false : null;
  const requestedDiscountPercent = Number(body.discountPercent ?? 0);
  const discountReason = text(body.discountReason, 1000);
  const discountApproverUsername = text(body.discountApproverUsername, 100).toLowerCase();
  const discountApproverPassword = typeof body.discountApproverPassword === "string" ? body.discountApproverPassword : "";
  const discountApproverMfaCode = text(body.discountApproverMfaCode, 20);

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

  let discountApprovalMethod: "SELF_LIMIT" | "APPROVER_REAUTH" | null = null;
  let discountApprovedByUserId: string | null = null;
  if (requestedApprovalMode === "SELF_LIMIT") {
    discountApprovalMethod = "SELF_LIMIT";
    discountApprovedByUserId = session.user.id;
  } else if (requestedApprovalMode === "APPROVER_REAUTH") {
    const limiter = await checkRateLimit({
      scope: "discount_approval_reauth",
      key: (ctx.ipAddress || "unknown") + ":" + (discountApproverUsername || "missing"),
      limit: 10,
      windowMs: 15 * 60_000,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: "discount_approval_rate_limited" },
        { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
      );
    }

    const approval = await verifyDiscountApprover(prisma, {
      organizationId: session.user.organizationId,
      branchId,
      username: discountApproverUsername,
      password: discountApproverPassword,
      mfaCode: discountApproverMfaCode || null,
      requestedPercent: requestedDiscountPercent,
    });
    if (!approval.ok) {
      return NextResponse.json({ error: approval.error }, { status: 403 });
    }
    discountApprovalMethod = "APPROVER_REAUTH";
    discountApprovedByUserId = approval.approver.id;
  }

  const packages = packageIds.length ? await prisma.commercialPackage.findMany({
    where: {
      id: { in: packageIds },
      organizationId: session.user.organizationId,
      status: "ACTIVE",
    },
    include: {
      items: {
        include: { test: { select: { id: true, status: true } } },
        orderBy: { displayOrder: "asc" },
      },
    },
  }) : [];
  if (packages.length !== packageIds.length) {
    return NextResponse.json({ error: "one_or_more_packages_not_found" }, { status: 404 });
  }

  const packageTestOwner = new Map<string, string>();
  for (const pkg of packages) {
    for (const item of pkg.items) {
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

  const [patient, tests, source, referrer, client] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, patientNumber: true, fullNameEn: true } }),
    prisma.labTest.findMany({
      where: { id: { in: allTestIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: {
        defaultUnit: true,
        specimenType: true,
        container: true,
        branchAvailability: { where: { status: "ACTIVE" } },
        orderQuestions: { where: { status: "ACTIVE" }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
      },
    }),
    prisma.orderSource.findFirst({ where: { id: sourceId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, code: true, category: true } }),
    referrerId ? prisma.referrer.findFirst({ where: { id: referrerId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, clientId: true } }) : null,
    clientId ? prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } }) : null,
  ]);

  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  if (tests.length !== allTestIds.length) return NextResponse.json({ error: "one_or_more_tests_not_found" }, { status: 404 });
  if (!source) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  if (referrerId && !referrer) return NextResponse.json({ error: "referrer_not_found" }, { status: 404 });
  if (clientId && !client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

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
    selectedOptionSnapshot: string | null;
  }>();

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
          answerText: stringValue.slice(0, 5000), answerNumeric: null, answerBoolean: null, answerDate: null, selectedOptionSnapshot: null,
        });
      } else if (question.responseType === "NUMERIC") {
        const value = new Prisma.Decimal(stringValue);
        preparedAnswers.set(question.id, {
          answerText: null, answerNumeric: value, answerBoolean: null, answerDate: null, selectedOptionSnapshot: null,
        });
      } else if (question.responseType === "BOOLEAN") {
        if (!["true","false"].includes(stringValue.toLowerCase())) throw new Error("INVALID_BOOLEAN");
        preparedAnswers.set(question.id, {
          answerText: null, answerNumeric: null, answerBoolean: stringValue.toLowerCase() === "true", answerDate: null, selectedOptionSnapshot: null,
        });
      } else if (question.responseType === "DATE") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) throw new Error("INVALID_DATE");
        const value = new Date(stringValue + "T00:00:00.000Z");
        if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== stringValue) throw new Error("INVALID_DATE");
        preparedAnswers.set(question.id, {
          answerText: null, answerNumeric: null, answerBoolean: null, answerDate: value, selectedOptionSnapshot: null,
        });
      } else if (question.responseType === "SINGLE_CHOICE") {
        const options = Array.isArray(question.options)
          ? question.options.filter((item): item is string => typeof item === "string")
          : [];
        if (!options.includes(stringValue)) throw new Error("INVALID_CHOICE");
        preparedAnswers.set(question.id, {
          answerText: null, answerNumeric: null, answerBoolean: null, answerDate: null, selectedOptionSnapshot: stringValue.slice(0, 500),
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
  const directTestIdSet = new Set(directTestIds);
  const directTests = tests.filter(test => directTestIdSet.has(test.id));

  const directPrices = await Promise.all(directTests.map(async test => ({
    test,
    price: await resolveTestPrice(prisma, {
      organizationId: session.user.organizationId,
      branchId,
      sourceId,
      clientId: effectiveClientId,
      testId: test.id,
    }),
  })));

  const packagePrices = await Promise.all(packages.map(async pkg => ({
    package: pkg,
    price: await resolvePackagePrice(prisma, {
      organizationId: session.user.organizationId,
      branchId,
      sourceId,
      clientId: effectiveClientId,
      packageId: pkg.id,
    }),
  })));

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

  try {
    const result = await prisma.$transaction(async (tx) => {
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
          referrerId,
          clientId: effectiveClientId,
          sourceId,
          priority,
          clinicalNotes: clinicalNotes || null,
          diagnosis: diagnosis || null,
          fasting,
          pregnancyInfo: pregnancyInfo || null,
          createdByUserId: session.user.id,
        },
      });

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
      }>();

      for (const pkg of packages) {
        const price = packagePriceMap.get(pkg.id)!;
        const unitPrice = new Prisma.Decimal(price.unitPrice);
        const discountAmount = new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4));
        const finalPrice = unitPrice.sub(discountAmount);
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
            taxAmountSnapshot: new Prisma.Decimal(0),
            finalPriceSnapshot: finalPrice,
            currency,
          },
        });
        createdOrderPackages.set(pkg.id, { id: orderPackage.id, package: pkg, unitPrice, discountAmount, finalPrice });
      }

      for (const test of tests) {
        const packageId = packageTestOwner.get(test.id) || null;
        const directPrice = packageId ? null : directPriceMap.get(test.id);
        if (!packageId && !directPrice) throw new Error("DIRECT_PRICE_RESOLUTION_MISSING");
        const unitPrice = packageId ? new Prisma.Decimal(0) : new Prisma.Decimal(directPrice!.unitPrice);
        const discountAmount = packageId
          ? new Prisma.Decimal(0)
          : new Prisma.Decimal(unitPrice.mul(requestedDiscountPercent).div(100).toFixed(4));
        const finalPrice = unitPrice.sub(discountAmount);
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
            taxAmountSnapshot: new Prisma.Decimal(0),
            finalPriceSnapshot: finalPrice,
            currency,
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
              answerText: answer.answerText,
              answerNumeric: answer.answerNumeric,
              answerBoolean: answer.answerBoolean,
              answerDate: answer.answerDate,
              selectedOptionSnapshot: answer.selectedOptionSnapshot,
              recordedByUserId: session.user.id,
            },
          });
        }

        createdItems.push({ item, test, unitPrice, discountAmount, finalPrice, packageId });
      }

      const specimenGroups = new Map<string, typeof createdItems>();
      for (const entry of createdItems) {
        const specimenTypeId = entry.test.specimenTypeId;
        const containerId = entry.test.containerId;
        const groupKey = specimenTypeId ? `${specimenTypeId}:${containerId || "NO_CONTAINER"}` : `ITEM:${entry.item.id}`;
        const group = specimenGroups.get(groupKey) || [];
        group.push(entry);
        specimenGroups.set(groupKey, group);
      }

      let specimenSequence = 1;
      for (const group of specimenGroups.values()) {
        const first = group[0];
        const barcode = `${accessionNumber}-${String(specimenSequence).padStart(2, "0")}`;
        const specimen = await tx.specimen.create({
          data: {
            organizationId: session.user.organizationId,
            orderId: order.id,
            specimenTypeId: first.test.specimenTypeId,
            containerId: first.test.containerId,
            barcode,
            sequenceNumber: specimenSequence,
            currentBranchId: branchId,
          },
        });

        await tx.specimenOrderItem.createMany({
          data: group.map((entry) => ({ specimenId: specimen.id, orderItemId: entry.item.id })),
        });

        await tx.specimenEvent.create({
          data: {
            specimenId: specimen.id,
            eventType: "CREATED",
            branchId,
            actorUserId: session.user.id,
            fromStatus: null,
            toStatus: "PLANNED",
            details: {
              barcode,
              specimenTypeCode: first.test.specimenType?.code || null,
              containerCode: first.test.container?.code || null,
              orderItemIds: group.map((entry) => entry.item.id),
            },
          },
        });

        specimenSequence++;
      }

      let invoiceNumber = documentNumber("INV");
      while (await tx.invoice.findUnique({ where: { organizationId_invoiceNumber: { organizationId: session.user.organizationId, invoiceNumber } } })) {
        invoiceNumber = documentNumber("INV");
      }

      const finalTotal = subtotal.sub(discountTotal);
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
          discountApprovedAt: requestedDiscountPercent > 0 ? new Date() : null,
          taxTotal: new Prisma.Decimal(0),
          total: finalTotal,
          paidAmount: new Prisma.Decimal(0),
          balanceAmount: finalTotal,
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
            taxAmount: new Prisma.Decimal(0),
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
            taxAmount: new Prisma.Decimal(0),
            lineTotal: orderPackage.finalPrice,
          },
        });
      }

      if (requestedDiscountPercent > 0 && discountApprovedByUserId && discountApprovalMethod) {
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: discountApprovedByUserId,
            action: "ORDER_DISCOUNT_APPROVED",
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
            directTestIds,
            packageIds,
            expandedTestIds: allTestIds,
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
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return { order, invoice, subtotal: subtotal.toString(), discountTotal: discountTotal.toString(), total: finalTotal.toString() };
    }, { timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      orderId: result.order.id,
      accessionNumber: result.order.accessionNumber,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      currency,
      subtotal: result.subtotal,
      discountPercent: requestedDiscountPercent.toFixed(2),
      discountTotal: result.discountTotal,
      total: result.total,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "order_creation_failed" }, { status: 500 });
  }
}
