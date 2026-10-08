import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nextQuestionVersion, parseConfiguredChoiceRows } from "@/lib/order-questions";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const responseTypes = new Set(["TEXT","NUMERIC","BOOLEAN","DATE","DATETIME","SINGLE_CHOICE"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const test = await prisma.labTest.findFirst({
    where: { id, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  const code = text(body.code, 100).toUpperCase();
  const questionEn = text(body.questionEn, 500);
  const questionAr = text(body.questionAr, 500) || null;
  const responseType = typeof body.responseType === "string" && responseTypes.has(body.responseType)
    ? body.responseType as "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "DATETIME" | "SINGLE_CHOICE"
    : null;
  const required = body.required === true;
  const displayOrder = Number.isInteger(body.displayOrder) ? Number(body.displayOrder) : 0;
  const options = parseConfiguredChoiceRows(body.options);
  const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom) + "T00:00:00.000Z") : new Date();
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo) + "T23:59:59.999Z") : null;

  if (!code || !questionEn || !responseType) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom))) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }
  if (responseType === "SINGLE_CHOICE" && options.length < 2) {
    return NextResponse.json({ error: "single_choice_requires_options" }, { status: 400 });
  }

  const existingVersions = await prisma.orderQuestion.findMany({
    where: {
      organizationId: session.user.organizationId,
      testId: test.id,
      code,
    },
    orderBy: [{ version: "desc" }, { effectiveFrom: "desc" }],
  });

  let versionInfo: { version: number; supersedesVersion: number | null };
  try {
    versionInfo = nextQuestionVersion(existingVersions, effectiveFrom);
  } catch (error) {
    if (error instanceof Error && error.message === "QUESTION_REVISION_MUST_START_AFTER_PREVIOUS_VERSION") {
      return NextResponse.json({ error: "question_revision_must_start_after_previous_version" }, { status: 409 });
    }
    throw error;
  }
  const previous = existingVersions[0] || null;

  const created = await prisma.$transaction(async tx => {
    if (previous && (previous.effectiveTo === null || previous.effectiveTo >= effectiveFrom)) {
      await tx.orderQuestion.update({
        where: { id: previous.id },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - 1) },
      });
    }

    const question = await tx.orderQuestion.create({
      data: {
        organizationId: session.user.organizationId,
        testId: test.id,
        code,
        questionEn,
        questionAr,
        responseType,
        required,
        options: responseType === "SINGLE_CHOICE" ? options : undefined,
        displayOrder,
        version: versionInfo.version,
        effectiveFrom,
        effectiveTo,
        supersedesQuestionId: previous?.id || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "ORDER_QUESTION_CREATED",
        entityType: "OrderQuestion",
        entityId: question.id,
        newValues: {
          testId: test.id,
          testCode: test.code,
          code,
          responseType,
          required,
          displayOrder,
          version: versionInfo.version,
          supersedesQuestionId: previous?.id || null,
          effectiveFrom,
          effectiveTo,
          optionCount: options.length,
          options,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return question;
  });

  return NextResponse.json({ status: "ok", question: created }, { status: 201 });
}
