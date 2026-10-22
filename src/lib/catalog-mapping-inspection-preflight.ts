import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BUNDLE_REVIEW_SOURCE } from "@/lib/catalog-bundle-review";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import { reviewStageBatchMetadata } from "@/lib/catalog-review-stage-evidence";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { validatePolicyReviewBatchScope } from "@/lib/catalog-policy-review-scope";
import { bundleTriageClass, triagePermissionScope } from "@/lib/catalog-drift-triage";
import {
  verifyMappingDiscussionHistory, MAPPING_DISCUSSION_HISTORY_LIMIT,
} from "@/lib/catalog-mapping-discussion-draft";
import { independentMappingInspection, type IndependentMappingInspection } from "@/lib/catalog-mapping-independent-inspection";
import { f2GovernedReadinessPreview, type F2GovernedReadiness } from "@/lib/catalog-f2-governed-readiness";
import { f2ReadOnlyBatchReconciliation, type F2BatchReconciliation } from "@/lib/catalog-f2-batch-reconciliation";
import type { MappingDiscussionDraft } from "@/lib/catalog-mapping-discussion-draft";
import type { Prisma } from "../../generated/prisma/client";
import { catalogExportTypes, type CatalogExportType } from "@/lib/catalog-configuration-export";
import { readCatalogLiveObservations } from "@/lib/catalog-live-observation";
import { catalogDriftObservationToken, matchesCatalogDriftObservation } from "@/lib/catalog-drift-triage";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };

function opaqueError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

/**
 * Independently scoped metadata inspection, deliberately GET-only. It
 * revalidates the exact current author-side full field observation token
 * without permitting any reviewer decision, medical sign-off or activation.
 */
export type MappingPreflightVerified = {
  tx: Prisma.TransactionClient;
  inspection: IndependentMappingInspection;
  readiness: F2GovernedReadiness;
  batchReconciliation: F2BatchReconciliation | null;
  batchReconciliationCoverage: "TEN_CLASS_COMPLETE" | "SOURCE_CLASS_INCOMPLETE" | "FULL_DOMAIN_SCOPE_REQUIRED" | "NOT_REQUESTED";
  draft: MappingDiscussionDraft;
  organizationId: string;
  batchId: string;
  branchId: string;
  rowId: string;
  rowNumber: number;
  entityType: string;
  authorUserId: string;
  reviewerUserId: string;
  sourceChecksum: string;
  currentObservationToken: string;
  secret: string;
};
type MappingPreflightAction = (evidence: MappingPreflightVerified) =>
  Promise<Record<string,unknown>>;

export async function runIndependentMappingPreflight(
  request: NextRequest, { params }: Context,
  onVerified?: MappingPreflightAction,
  includeBatchReconciliation = false,
  allowSignedProvenanceValueChanges = false,
) {
  if(includeBatchReconciliation && request.method!=="GET")
    return opaqueError("mapping_inspection_batch_get_only",405);
  const query = request.nextUrl.searchParams;
  const rowId = query.get("rowId");
  if ([...query.keys()].sort().join(",") !== "rowId" ||
      !rowId || !UUID.test(rowId))
    return opaqueError("mapping_inspection_invalid_request",400);

  const session = await getCurrentSession();
  if (!session) return opaqueError("unauthorized",401);
  const original = permissionSet(session);
  if (!original.has("catalog.manage"))
    return opaqueError("mapping_inspection_permission_required",403);
  const { id: batchId } = await params;
  if (!UUID.test(batchId)) return opaqueError("mapping_inspection_not_found",404);
  const organizationId = session.user.organizationId;
  const secret = catalogBundleSigningSecret(process.env);
  if (!secret) return opaqueError("mapping_inspection_key_unavailable",503);

  const result = await prisma.$transaction(async tx => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId}
      AND status = 'ACTIVE' FOR UPDATE
    `;
    if (!locked) return { error: "mapping_inspection_organization_inactive", httpStatus: 403 } as const;

    const activeUser = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: { role: { include: {
        permissions: { include: { permission: true } },
      } } } } },
    });
    const current = new Set(activeUser?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(grant => grant.permission.code)) || []);
    if (!current.has("catalog.manage"))
      return { error: "mapping_inspection_permission_revoked", httpStatus: 403 } as const;

    const branch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, status: true, organizationId: true },
    });
    const branchGrants = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const originallyGranted = new Set(session.user.branchScopes.filter(item =>
      item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
    ).map(item => item.branchId));
    const grantedBranchIds = branchGrants.filter(item => originallyGranted.has(item.branchId))
      .map(item => item.branchId);
    const departmentGrants = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const originalDepartmentIds = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restricted = session.user.departmentScopes.length > 0;
    const departments = restricted
      ? departmentGrants.filter(item => originalDepartmentIds.has(item.departmentId))
      : departmentGrants;
    if (restricted && !departments.length)
      return { error: "mapping_inspection_department_revoked", httpStatus: 403 } as const;
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: branch,
      branchScopes: grantedBranchIds.map(branchId => ({
        branchId,branch:{status:"ACTIVE"},
      })),
      departmentScopes: departments,
    });
    if (!scope) return { error: "mapping_inspection_scope_revoked", httpStatus: 403 } as const;

    const batch = await tx.catalogImportBatch.findFirst({
      where: { id: batchId, organizationId, sourceType: BUNDLE_REVIEW_SOURCE,
        status: "DRAFT" },
      select: { id: true, sourceType: true, sourceName: true, status: true,
        sourceChecksum: true, summary: true, createdByUserId: true },
    });
    if (!batch?.sourceChecksum)
      return { error: "mapping_inspection_not_found", httpStatus: 404 } as const;
    if (batch.createdByUserId === session.user.id)
      return { error: "mapping_inspection_independent_reviewer_required", httpStatus: 403 } as const;

    const row = await tx.catalogImportRow.findFirst({
      where: { id: rowId, batchId: batch.id },
      select: { id: true, rowNumber: true, entityType: true, sourceData: true, normalizedData: true },
    });
    if (!row) return { error: "mapping_inspection_not_found", httpStatus: 404 } as const;
    const category = bundleTriageClass(row.entityType);
    if (!category || !triagePermissionScope(category, original) ||
        !triagePermissionScope(category, current))
      return { error: "mapping_inspection_domain_permission_required", httpStatus: 403 } as const;

    // Re-read ALL ten-class DRAFT rows and scoped live masters inside the
    // same tenant lock; source evidence and tariff/range snapshots stay private.
    const stage = await validatePolicyReviewBatchScope(tx,{
      batchId:batch.id,scope,grantedBranchIds,
      sourceChecksum:batch.sourceChecksum,authorUserId:batch.createdByUserId,
      stageEvidenceSeal:batch.summary && typeof batch.summary==="object" &&
        !Array.isArray(batch.summary) ? batch.summary.stageEvidenceSeal : null,
      batchMetadata:reviewStageBatchMetadata(batch),signingSecret:secret,
      // Only the independent source-authority intake may inspect planned
      // clinical/tariff DIFFERENCES; ordinary review remains strict.
      allowGovernedValueDifferences:allowSignedProvenanceValueChanges ? true : undefined,
    });
    if (!stage.ok)
      return { error: stage.error, httpStatus: 409 } as const;

    const revisions = await tx.auditEvent.findMany({
      where: {
        organizationId,entityType:"CatalogImportRow",entityId:row.id,
        action:"CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED",
      },
      orderBy:[{occurredAt:"desc"},{id:"desc"}],
      take:MAPPING_DISCUSSION_HISTORY_LIMIT+1,
      select:{id:true,branchId:true,actorUserId:true,newValues:true},
    });
    const history = verifyMappingDiscussionHistory({
      context:{
        organizationId,batchId:batch.id,branchId:scope.branchId,
        rowId:row.id,authorUserId:batch.createdByUserId,
        sourceChecksum:batch.sourceChecksum,
        rowNumber:row.rowNumber,entityType:row.entityType,
      },
      events:revisions,secret,
    });
    if (!history) return { error: "mapping_inspection_history_corrupt", httpStatus: 409 } as const;
    if (!history.draft)
      return { error: "mapping_inspection_no_discussion", httpStatus: 404 } as const;

    const normalized = row.normalizedData;
    const targetId = normalized && typeof normalized === "object" &&
      !Array.isArray(normalized) && "id" in normalized ? normalized.id : null;
    if (typeof targetId !== "string" || !UUID.test(targetId))
      return { error: "mapping_inspection_evidence_invalid", httpStatus: 409 } as const;
    const live = await readCatalogLiveObservations(tx,scope,grantedBranchIds,
      new Map<CatalogExportType,string[]>([[row.entityType as CatalogExportType, [targetId]]]));
    const observation = live?.get(row.entityType + ":" + targetId);
    if (!observation)
      return { error: "mapping_inspection_live_scope_changed", httpStatus: 409 } as const;
    const token = catalogDriftObservationToken(secret,batch.sourceChecksum,
      row.rowNumber,row.entityType,row.sourceData,observation);
    if (!matchesCatalogDriftObservation(history.draft.observationToken,token))
      return { error: "mapping_inspection_live_observation_stale", httpStatus: 409 } as const;

    const view = independentMappingInspection({
      entityType:row.entityType,authenticatedDraft:history.draft,
      currentObservationToken:token,
      userId:session.user.id,authorUserId:batch.createdByUserId,
      originalPermissions:original,currentPermissions:current,
    });
    if (!view)
      return { error: "mapping_inspection_not_eligible", httpStatus: 403 } as const;
    const readiness = f2GovernedReadinessPreview({
      entityType:row.entityType,sourceData:row.sourceData,
      scopedLiveData:observation,
      signedStageVerified:true,liveFieldObservationRevalidated:true,
    });
    if (!readiness)
      return { error: "mapping_inspection_incomplete_projection", httpStatus: 409 } as const;
    // Whole-stage closeout is available ONLY to a reviewer with the full
    // original AND current clinical/financial grant set. The ordinary row
    // inspection and author feedback workflow remain unchanged.
    let batchReconciliation: F2BatchReconciliation | null = null;
    let batchReconciliationCoverage: MappingPreflightVerified["batchReconciliationCoverage"] =
      "NOT_REQUESTED";
    if (includeBatchReconciliation) {
      const fullDomain = ["catalog.reference_ranges.manage","pricing.manage"]
        .every(grant=>original.has(grant) && current.has(grant));
      batchReconciliationCoverage = fullDomain
        ? "SOURCE_CLASS_INCOMPLETE" : "FULL_DOMAIN_SCOPE_REQUIRED";
      if (fullDomain) {
        const allRows = await tx.catalogImportRow.findMany({
          where:{batchId:batch.id},orderBy:{rowNumber:"asc"},
          select:{rowNumber:true,entityType:true,sourceData:true,normalizedData:true},
        });
        const present = new Set(allRows.map(item=>item.entityType));
        if ([...present].length === 10 &&
            [...catalogExportTypes].every(type=>present.has(type))) {
          const byType = new Map<CatalogExportType,string[]>();
          for (const item of allRows) {
            const target = item.normalizedData;
            const value = target && typeof target==="object" &&
              !Array.isArray(target) && "id" in target ? target.id : null;
            if (typeof value!=="string" || !UUID.test(value))
              return { error:"mapping_inspection_batch_identity_invalid",httpStatus:409 } as const;
            const type=item.entityType as CatalogExportType;
            byType.set(type,[...(byType.get(type)||[]),value]);
          }
          const allLive=await readCatalogLiveObservations(
            tx,scope,grantedBranchIds,byType);
          if (!allLive)
            return { error:"mapping_inspection_batch_live_scope_changed",httpStatus:409 } as const;
          const joined=allRows.map(item=>{
            const normalized=item.normalizedData;
            const id=normalized && typeof normalized==="object" &&
              !Array.isArray(normalized) && "id" in normalized ? normalized.id : null;
            return { ...item,scopedLiveData:
              allLive.get(item.entityType+":"+id) ?? null };
          });
          batchReconciliation=f2ReadOnlyBatchReconciliation({
            rows:joined,wholeStageHmacVerified:true,
            currentTenClassScopeVerified:true,currentLiveSnapshotVerified:true,
          });
          if(!batchReconciliation)
            return { error:"mapping_inspection_batch_reconciliation_invalid",httpStatus:409 } as const;
          batchReconciliationCoverage="TEN_CLASS_COMPLETE";
        }
      }
    }
    if (!onVerified) return { ...view, readiness, batchReconciliation,
      batchReconciliationCoverage };
    return onVerified({
      tx,inspection:view,readiness,batchReconciliation,batchReconciliationCoverage,
      draft:history.draft,
      organizationId,batchId:batch.id,branchId:scope.branchId,
      rowId:row.id,rowNumber:row.rowNumber,entityType:row.entityType,
      authorUserId:batch.createdByUserId,reviewerUserId:session.user.id,
      sourceChecksum:batch.sourceChecksum,currentObservationToken:token,secret,
    });
  },{isolationLevel:"RepeatableRead",timeout:30000});

  if ("error" in result && typeof result.error==="string" &&
      "httpStatus" in result && typeof result.httpStatus==="number")
    return opaqueError(result.error,result.httpStatus);
  return NextResponse.json(result,{headers});
}
