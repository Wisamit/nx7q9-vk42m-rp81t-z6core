import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizedCode(value: unknown) {
  return text(value, 80).toUpperCase().replace(/[^A-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

const layouts = new Set(["STANDARD", "SECTIONED", "COMPACT_GRID"]);
const fieldWidths = new Set(["AUTO", "NARROW", "STANDARD", "WIDE", "FULL"]);

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const action = text(body.action, 40);
  const testId = text(body.testId, 36);

  if (!testId) return NextResponse.json({ error: "test_required" }, { status: 400 });

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  if (action === "SET_LAYOUT") {
    const layout = text(body.layout, 40);
    if (!layouts.has(layout)) return NextResponse.json({ error: "invalid_layout" }, { status: 400 });
    if (test.resultEntryLayout === layout) return NextResponse.json({ status: "ok", test });

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.labTest.update({
        where: { id: test.id },
        data: { resultEntryLayout: layout as "STANDARD" | "SECTIONED" | "COMPACT_GRID" },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_ENTRY_LAYOUT_CHANGED",
          entityType: "LabTest",
          entityId: test.id,
          oldValues: { resultEntryLayout: test.resultEntryLayout },
          newValues: { resultEntryLayout: layout },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return changed;
    });

    return NextResponse.json({ status: "ok", test: updated });
  }

  if (action === "CREATE_SECTION") {
    const sectionCode = normalizedCode(body.code);
    const nameEn = text(body.nameEn, 200);
    const nameAr = text(body.nameAr, 200) || null;
    const displayOrder = body.displayOrder === "" || body.displayOrder == null ? 0 : Number(body.displayOrder);
    const columnCount = body.columnCount === "" || body.columnCount == null ? 3 : Number(body.columnCount);
    const hintEn = text(body.hintEn, 500) || null;
    const hintAr = text(body.hintAr, 500) || null;

    if (!sectionCode || !nameEn || !/^[A-Z0-9._-]{1,80}$/.test(sectionCode)) {
      return NextResponse.json({ error: "invalid_section_fields" }, { status: 400 });
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10000) {
      return NextResponse.json({ error: "invalid_display_order" }, { status: 400 });
    }
    if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > 4) {
      return NextResponse.json({ error: "invalid_column_count" }, { status: 400 });
    }

    try {
      const section = await prisma.$transaction(async (tx) => {
        const created = await tx.testResultSection.create({
          data: {
            testId: test.id,
            code: sectionCode,
            nameEn,
            nameAr,
            displayOrder,
            columnCount,
            hintEn,
            hintAr,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "RESULT_SECTION_CREATED",
            entityType: "TestResultSection",
            entityId: created.id,
            newValues: { testId: test.id, code: sectionCode, nameEn, nameAr, displayOrder, columnCount, hintEn, hintAr },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        return created;
      });

      return NextResponse.json({ status: "ok", section }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "section_code_already_exists" }, { status: 409 });
    }
  }

  if (action === "ASSIGN_COMPONENT") {
    const componentId = text(body.componentId, 36);
    const sectionId = text(body.sectionId, 36) || null;
    if (!componentId) return NextResponse.json({ error: "component_required" }, { status: 400 });

    const component = await prisma.testComponent.findFirst({
      where: { id: componentId, testId: test.id },
    });
    if (!component) return NextResponse.json({ error: "component_not_found" }, { status: 404 });

    if (sectionId) {
      const section = await prisma.testResultSection.findFirst({
        where: { id: sectionId, testId: test.id, status: "ACTIVE" },
      });
      if (!section) return NextResponse.json({ error: "section_not_found_or_inactive" }, { status: 404 });
    }

    if (component.resultSectionId === sectionId) {
      return NextResponse.json({ status: "ok", component });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.testComponent.update({
        where: { id: component.id },
        data: { resultSectionId: sectionId },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_COMPONENT_SECTION_ASSIGNED",
          entityType: "TestComponent",
          entityId: component.id,
          oldValues: { resultSectionId: component.resultSectionId },
          newValues: { testId: test.id, resultSectionId: sectionId },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return changed;
    });

    return NextResponse.json({ status: "ok", component: updated });
  }

  if (action === "UPDATE_SECTION_PRESENTATION") {
    const sectionId = text(body.sectionId, 36);
    const columnCount = Number(body.columnCount);
    const hintEn = text(body.hintEn, 500) || null;
    const hintAr = text(body.hintAr, 500) || null;
    if (!sectionId || !Number.isInteger(columnCount) || columnCount < 1 || columnCount > 4) {
      return NextResponse.json({ error: "invalid_section_presentation" }, { status: 400 });
    }

    const section = await prisma.testResultSection.findFirst({
      where: { id: sectionId, testId: test.id },
    });
    if (!section) return NextResponse.json({ error: "section_not_found" }, { status: 404 });

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.testResultSection.update({
        where: { id: section.id },
        data: { columnCount, hintEn, hintAr },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_SECTION_PRESENTATION_UPDATED",
          entityType: "TestResultSection",
          entityId: section.id,
          oldValues: { columnCount: section.columnCount, hintEn: section.hintEn, hintAr: section.hintAr },
          newValues: { columnCount, hintEn, hintAr },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return changed;
    });

    return NextResponse.json({ status: "ok", section: updated });
  }

  if (action === "UPDATE_COMPONENT_PRESENTATION") {
    const componentId = text(body.componentId, 36);
    const entryWidth = text(body.entryWidth, 40);
    const entryHintEn = text(body.entryHintEn, 500) || null;
    const entryHintAr = text(body.entryHintAr, 500) || null;
    if (!componentId || !fieldWidths.has(entryWidth)) {
      return NextResponse.json({ error: "invalid_component_presentation" }, { status: 400 });
    }

    const component = await prisma.testComponent.findFirst({
      where: { id: componentId, testId: test.id },
    });
    if (!component) return NextResponse.json({ error: "component_not_found" }, { status: 404 });

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.testComponent.update({
        where: { id: component.id },
        data: { entryWidth: entryWidth as "AUTO" | "NARROW" | "STANDARD" | "WIDE" | "FULL", entryHintEn, entryHintAr },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_COMPONENT_PRESENTATION_UPDATED",
          entityType: "TestComponent",
          entityId: component.id,
          oldValues: { entryWidth: component.entryWidth, entryHintEn: component.entryHintEn, entryHintAr: component.entryHintAr },
          newValues: { entryWidth, entryHintEn, entryHintAr },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return changed;
    });

    return NextResponse.json({ status: "ok", component: updated });
  }

  if (action === "SET_SECTION_STATUS") {
    const sectionId = text(body.sectionId, 36);
    const status = body.status === "ACTIVE" ? "ACTIVE" : body.status === "INACTIVE" ? "INACTIVE" : null;
    if (!sectionId || !status) return NextResponse.json({ error: "invalid_section_status" }, { status: 400 });

    const section = await prisma.testResultSection.findFirst({
      where: { id: sectionId, testId: test.id },
    });
    if (!section) return NextResponse.json({ error: "section_not_found" }, { status: 404 });
    if (section.status === status) return NextResponse.json({ status: "ok", section });

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.testResultSection.update({
        where: { id: section.id },
        data: {
          status,
          deactivatedAt: status === "INACTIVE" ? new Date() : null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: status === "INACTIVE" ? "RESULT_SECTION_DEACTIVATED" : "RESULT_SECTION_REACTIVATED",
          entityType: "TestResultSection",
          entityId: section.id,
          oldValues: { status: section.status },
          newValues: { status },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return changed;
    });

    return NextResponse.json({ status: "ok", section: updated });
  }

  return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
}
