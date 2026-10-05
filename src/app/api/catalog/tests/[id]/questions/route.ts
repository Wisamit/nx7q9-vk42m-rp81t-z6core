import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const responseTypes = new Set(["TEXT","NUMERIC","BOOLEAN","DATE","SINGLE_CHOICE"]);

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
    ? body.responseType as "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "SINGLE_CHOICE"
    : null;
  const required = body.required === true;
  const displayOrder = Number.isInteger(body.displayOrder) ? Number(body.displayOrder) : 0;
  const options = Array.isArray(body.options)
    ? [...new Set(body.options.map(item => text(item, 500)).filter(Boolean))].slice(0, 100)
    : [];

  if (!code || !questionEn || !responseType) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (responseType === "SINGLE_CHOICE" && options.length < 2) {
    return NextResponse.json({ error: "single_choice_requires_options" }, { status: 400 });
  }

  const created = await prisma.$transaction(async tx => {
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
          optionCount: options.length,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return question;
  });

  return NextResponse.json({ status: "ok", question: created }, { status: 201 });
}
