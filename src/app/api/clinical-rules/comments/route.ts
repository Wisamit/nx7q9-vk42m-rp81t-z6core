import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export async function POST(request: Request) {
  const session = await requirePermission("result_comments.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const scope = ["ORGANIZATION","TEST","COMPONENT"].includes(body.scope) ? body.scope : "ORGANIZATION";
  const testId = text(body.testId, 36) || null;
  const componentId = text(body.componentId, 36) || null;
  const nameEn = text(body.nameEn, 220);
  const nameAr = text(body.nameAr, 220);
  const textEn = text(body.textEn, 5000);
  const textAr = text(body.textAr, 5000);
  const templateCode = code(text(body.code, 80) || nameEn);

  if (!nameEn || !textEn || !templateCode) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (scope === "TEST" && !testId) return NextResponse.json({ error: "test_required" }, { status: 400 });
  if (scope === "COMPONENT" && (!testId || !componentId)) return NextResponse.json({ error: "component_required" }, { status: 400 });

  if (testId) {
    const test = await prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId },
      include: { components: true },
    });
    if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
    if (componentId && !test.components.some(component => component.id === componentId)) {
      return NextResponse.json({ error: "component_not_belong_to_test" }, { status: 409 });
    }
  }

  try {
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.resultCommentTemplate.create({
        data: {
          organizationId: session.user.organizationId,
          scope,
          testId: scope === "ORGANIZATION" ? null : testId,
          componentId: scope === "COMPONENT" ? componentId : null,
          code: templateCode,
          nameEn,
          nameAr: nameAr || null,
          textEn,
          textAr: textAr || null,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_COMMENT_TEMPLATE_CREATED",
          entityType: "ResultCommentTemplate",
          entityId: created.id,
          newValues: { code: templateCode, scope, testId, componentId, nameEn },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", template }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "template_code_already_exists" }, { status: 409 });
  }
}
