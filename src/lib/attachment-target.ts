import { canAccessBranch, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { AttachmentTargetType } from "../../generated/prisma/client";

type Session = NonNullable<Awaited<ReturnType<typeof import("@/lib/auth").getCurrentSession>>>;

function hasAny(permissions: Set<string>, values: string[]) {
  return values.some(value => permissions.has(value));
}

export async function resolveAttachmentTarget(session: Session, targetType: AttachmentTargetType, targetId: string) {
  const permissions = permissionSet(session);
  const organizationId = session.user.organizationId;

  if (targetType === "PATIENT") {
    if (!permissions.has("patients.view")) return null;
    const row = await prisma.patient.findFirst({ where: { id: targetId, organizationId }, select: { id: true, patientNumber: true } });
    return row ? { branchId: null, label: "Patient " + row.patientNumber } : null;
  }

  if (targetType === "ORDER") {
    if (!permissions.has("orders.view")) return null;
    const row = await prisma.labOrder.findFirst({ where: { id: targetId, organizationId }, select: { id: true, accessionNumber: true, orderingBranchId: true } });
    return row && canAccessBranch(session, row.orderingBranchId) ? { branchId: row.orderingBranchId, label: "Order " + row.accessionNumber } : null;
  }

  if (targetType === "RESULT") {
    if (!hasAny(permissions, ["worklists.view", "reports.view", "results.enter"])) return null;
    const row = await prisma.laboratoryResult.findFirst({ where: { id: targetId, organizationId }, select: { id: true, performingBranchId: true } });
    return row && canAccessBranch(session, row.performingBranchId) ? { branchId: row.performingBranchId, label: "Laboratory result" } : null;
  }

  if (targetType === "SEND_OUT_REFERRAL") {
    if (!permissions.has("sendouts.view")) return null;
    const row = await prisma.sendOutReferral.findFirst({ where: { id: targetId, organizationId }, select: { id: true, branchId: true, externalAccession: true } });
    return row && canAccessBranch(session, row.branchId) ? { branchId: row.branchId, label: "Send-out " + (row.externalAccession || row.id.slice(0,8)) } : null;
  }

  if (targetType === "EQUIPMENT") {
    if (!permissions.has("equipment.view")) return null;
    const row = await prisma.equipment.findFirst({ where: { id: targetId, organizationId }, select: { id: true, branchId: true, assetId: true } });
    return row && canAccessBranch(session, row.branchId) ? { branchId: row.branchId, label: "Equipment " + row.assetId } : null;
  }

  if (targetType === "MAINTENANCE") {
    if (!permissions.has("equipment.view")) return null;
    const row = await prisma.maintenanceEvent.findFirst({
      where: { id: targetId, equipment: { organizationId } },
      select: { id: true, equipment: { select: { branchId: true, assetId: true } } },
    });
    return row && canAccessBranch(session, row.equipment.branchId) ? { branchId: row.equipment.branchId, label: "Maintenance " + row.equipment.assetId } : null;
  }

  if (targetType === "NONCONFORMANCE") {
    if (!permissions.has("quality.view")) return null;
    const row = await prisma.nonconformance.findFirst({ where: { id: targetId, organizationId }, select: { id: true, branchId: true, caseNumber: true } });
    if (!row || (row.branchId && !canAccessBranch(session, row.branchId))) return null;
    return { branchId: row.branchId, label: "Nonconformance " + row.caseNumber };
  }

  if (targetType === "CAPA") {
    if (!permissions.has("quality.view")) return null;
    const row = await prisma.capa.findFirst({ where: { id: targetId, organizationId }, select: { id: true, branchId: true, capaNumber: true } });
    if (!row || (row.branchId && !canAccessBranch(session, row.branchId))) return null;
    return { branchId: row.branchId, label: "CAPA " + row.capaNumber };
  }

  if (targetType === "QUALITY_DOCUMENT_VERSION") {
    if (!permissions.has("quality.view")) return null;
    const row = await prisma.qualityDocumentVersion.findFirst({
      where: { id: targetId, document: { organizationId } },
      select: { id: true, version: true, document: { select: { branchId: true, code: true } } },
    });
    if (!row || (row.document.branchId && !canAccessBranch(session, row.document.branchId))) return null;
    return { branchId: row.document.branchId, label: row.document.code + " v" + row.version };
  }

  return null;
}
