import { Prisma } from "../../generated/prisma/client";
import { prisma } from "@/lib/db";

export type ScopedHistoryAttachment = {
  id: string;
  targetType: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
};

// Attachment targets are polymorphic and not FK-referenced by Prisma.
// Evaluate ownership/branch/clinical release *in SQL before LIMIT/OFFSET*;
// enumerating all patient order/result identifiers would defeat pagination.
export async function scopedHistoryAttachments(input: {
  organizationId: string;
  patientIds: string[];
  branchIds: string[];
  departmentIds: string[];
  canViewOrders: boolean;
  canViewReports: boolean;
  skip: number;
  take: number;
}) {
  const { organizationId, patientIds, branchIds, departmentIds, canViewOrders,
    canViewReports, skip, take } = input;
  if (patientIds.length === 0 || branchIds.length === 0) return [] as ScopedHistoryAttachment[];
  const departmentsForOrders = departmentIds.length
    ? Prisma.sql`AND EXISTS (
      SELECT 1 FROM order_items oi JOIN lab_tests t ON t.id = oi.test_id
      WHERE oi.order_id = o.id AND t.department_id IN (${Prisma.join(departmentIds)})
    )`
    : Prisma.empty;
  const departmentsForResults = departmentIds.length
    ? Prisma.sql`AND t.department_id IN (${Prisma.join(departmentIds)})`
    : Prisma.empty;
  const orderTargets = canViewOrders
    ? Prisma.sql`OR (
      a.target_type = 'ORDER' AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = a.target_id
          AND o.organization_id = ${organizationId}
          AND o.patient_id IN (${Prisma.join(patientIds)})
          AND o.ordering_branch_id IN (${Prisma.join(branchIds)})
          ${departmentsForOrders}
      )
    )`
    : Prisma.empty;
  const resultTargets = canViewReports
    ? Prisma.sql`OR (
      a.target_type = 'RESULT' AND EXISTS (
        SELECT 1 FROM laboratory_results r
        JOIN order_items oi ON oi.id = r.order_item_id
        JOIN lab_tests t ON t.id = oi.test_id
        JOIN orders o ON o.id = oi.order_id
        JOIN diagnostic_reports d ON d.order_id = o.id AND d.organization_id = ${organizationId}
        JOIN diagnostic_report_versions v ON v.report_id = d.id AND v.version = d.current_version
        WHERE r.id = a.target_id
          AND r.organization_id = ${organizationId}
          AND r.performing_branch_id IN (${Prisma.join(branchIds)})
          AND r.status IN ('RELEASED','AMENDED')
          AND o.organization_id = ${organizationId}
          AND o.patient_id IN (${Prisma.join(patientIds)})
          AND v.status IN ('PARTIAL','FINAL','AMENDED')
          AND JSON_CONTAINS(v.result_version_snapshot, JSON_OBJECT(
            'resultId', r.id, 'orderItemId', r.order_item_id, 'resultVersion', r.version
          )) = 1
          ${departmentsForResults}
      )
    )`
    : Prisma.empty;

  return prisma.$queryRaw<ScopedHistoryAttachment[]>(Prisma.sql`
    SELECT a.id AS id, a.target_type AS targetType,
           a.original_name AS originalName, a.content_type AS contentType,
           a.size_bytes AS sizeBytes, a.created_at AS createdAt
    FROM attachments a
    WHERE a.organization_id = ${organizationId}
      AND a.branch_id IN (${Prisma.join(branchIds)})
      AND (
        (a.target_type = 'PATIENT' AND a.target_id IN (${Prisma.join(patientIds)}))
        ${orderTargets}
        ${resultTargets}
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${take} OFFSET ${skip}
  `);
}
