import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE, BUNDLE_REVIEW_MAX_ROWS } from "@/lib/catalog-bundle-review";
import { catalogBundleDrift } from "@/lib/catalog-bundle-drift";
import { observeCatalogTargetIdentity } from "@/lib/catalog-bundle-target-identity";
import { reviewStageBatchMetadata } from "@/lib/catalog-review-stage-evidence";
import { verifyIndependentExpertStage } from "@/lib/catalog-expert-stage-integrity";
import {
  MAPPING_DISCUSSION_HISTORY_LIMIT, validMappingDiscussionIntent,
  verifyMappingDiscussionHistory, mappingDiscussionCurrent, createMappingDiscussionDraft,
  type MappingDiscussionIntent,
} from "@/lib/catalog-mapping-discussion-draft";
import { classifyCatalogReviewDrift } from "@/lib/catalog-field-review-eligibility";
import { resolveFindingLifecycle, triageResubmission } from "@/lib/catalog-finding-lifecycle";
import { summarizeCatalogGovernance } from "@/lib/catalog-governance-readiness";
import { summarizeSignatoryPlanning } from "@/lib/catalog-signatory-planning";
import { policyDraftAuthorFeedback } from "@/lib/catalog-policy-feedback";
import {
  POLICY_DRAFT_HISTORY_LIMIT, verifyBranchScopedPolicyDraftHistory,
  policyAuditBranchesMatch,
} from "@/lib/catalog-policy-draft-history";
import {
  validateCatalogPolicyProposal, createPolicyDraftLedgerEntry, catalogPolicyDraftDigest,
  type CatalogPolicyProposal,
} from "@/lib/catalog-signatory-policy-draft";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import {
  bundleTriageClass, catalogDriftObservationToken, matchesCatalogDriftObservation,
  triagePermissionScope, validTriageReason, type TriageReason,
} from "@/lib/catalog-drift-triage";
import { catalogExportTypes, type CatalogExportType } from "@/lib/catalog-configuration-export";
import { expertDispositionAllowed, validExpertDisposition, type ExpertDisposition } from "@/lib/catalog-expert-disposition";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Drift must inspect all exportable signed-bundle groups.
const ordered: CatalogExportType[] = [...catalogExportTypes];
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

type Context = { params: Promise<{ id: string }> };
type TriageInput = { rowNumber: number; observationToken: string; reasonCode: TriageReason };
type ExpertInput = { flagEventId: string; disposition: ExpertDisposition };
type PolicyDraftInput = { expectedRevision: number; proposal: CatalogPolicyProposal };
type MappingDiscussionInput = {
  rowNumber: number; expectedRevision: number; observationToken: string;
  intent: MappingDiscussionIntent;
};

/** A bounded, live-scoped snapshot diff. No source or live values in response. */
export async function GET(request: NextRequest, context: Context) {
  const query = request.nextUrl.searchParams;
  if (query.has("mappingDraftRow")) {
    const row = query.get("mappingDraftRow") || "";
    if ([...query.keys()].some(key => key !== "mappingDraftRow") ||
        !/^[1-9]\\d{0,8}$/.test(row))
      return NextResponse.json({ error: "mapping_discussion_query_invalid" }, { status: 400 });
    return inspectBundleDrift(request, context, null, null, false, false,
      null, Number(row));
  }
  const requestedReview = query.get("reviewFlagId");
  if (query.has("governance")) {
    if (query.get("governance") !== "1" || [...query.keys()].some(key => key !== "governance"))
      return NextResponse.json({ error: "governance_invalid_request" }, { status: 400 });
    return inspectBundleDrift(request, context, null, null, false, true);
  }
  if (requestedReview !== null) {
    // Explicit review inspection must not silently fall back to author mode.
    if (!UUID.test(requestedReview) || [...query.keys()].some(key => key !== "reviewFlagId"))
      return NextResponse.json({ error: "expert_preflight_invalid_request" }, { status: 400 });
    return inspectBundleDrift(request, context, null, {
      flagEventId: requestedReview, disposition: "CONFIRM_FINDING",
    }, true);
  }
  return inspectBundleDrift(request, context, null);
}

/** Append a domain-scoped review request, never an activation or approval. */
export async function POST(request: NextRequest, context: Context) {
  if (request.nextUrl.searchParams.has("mappingDraft")) {
    const query = request.nextUrl.searchParams;
    if (query.get("mappingDraft") !== "1" ||
        [...query.keys()].some(key => key !== "mappingDraft"))
      return NextResponse.json({ error: "mapping_discussion_invalid_query" }, { status: 400 });
    if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json")
      return NextResponse.json({ error: "mapping_discussion_json_required" }, { status: 415 });
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return NextResponse.json({ error: "mapping_discussion_cross_site_request" }, { status: 403 });
    const length=Number(request.headers.get("content-length") || 0);
    if (!Number.isFinite(length) || length < 0 || length > 768)
      return NextResponse.json({ error: "mapping_discussion_too_large" }, { status: 413 });
    const reader=request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "mapping_discussion_missing_body" }, { status: 400 });
    const chunks: Uint8Array[]=[];
    let bytes=0;
    for (;;) {
      const part=await reader.read();
      if(part.done) break;
      bytes+=part.value.byteLength;
      if(bytes>768){
        await reader.cancel("mapping_discussion_too_large");
        return NextResponse.json({ error: "mapping_discussion_too_large" }, { status: 413 });
      }
      chunks.push(part.value);
    }
    let value: Record<string, unknown> | null=null;
    try{value=record(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks))));}
    catch{return NextResponse.json({error:"mapping_discussion_invalid_json"},{status:400});}
    if(!value || Object.keys(value).sort().join(",") !==
        "expectedRevision,intent,observationToken,rowNumber" ||
        !Number.isSafeInteger(value.rowNumber) || (value.rowNumber as number)<1 ||
        (value.rowNumber as number)>999999999 ||
        !Number.isSafeInteger(value.expectedRevision) ||
        (value.expectedRevision as number)<0 ||
        (value.expectedRevision as number)>MAPPING_DISCUSSION_HISTORY_LIMIT ||
        typeof value.observationToken!=="string" ||
        !/^[a-f0-9]{64}$/.test(value.observationToken) ||
        !validMappingDiscussionIntent(value.intent))
      return NextResponse.json({error:"mapping_discussion_invalid_request"},{status:400});
    return inspectBundleDrift(request,context,null,null,false,false,null,null,{
      rowNumber:value.rowNumber as number,
      expectedRevision:value.expectedRevision as number,
      observationToken:value.observationToken,
      intent:value.intent,
    });
  }
  if (request.nextUrl.searchParams.has("policyDraft")) {
    const query = request.nextUrl.searchParams;
    if (query.get("policyDraft") !== "1" ||
        [...query.keys()].some(key => key !== "policyDraft"))
      return NextResponse.json({ error: "policy_draft_invalid_query" }, { status: 400 });
    if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json")
      return NextResponse.json({ error: "policy_draft_json_required" }, { status: 415 });
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return NextResponse.json({ error: "policy_draft_cross_site_request" }, { status: 403 });
    const suppliedLength = Number(request.headers.get("content-length") || "0");
    if (!Number.isFinite(suppliedLength) || suppliedLength < 0 || suppliedLength > 2048)
      return NextResponse.json({ error: "policy_draft_payload_too_large" }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "policy_draft_payload_missing" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let readLength = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      readLength += result.value.byteLength;
      if (readLength > 2048) {
        await reader.cancel("policy_draft_payload_too_large");
        return NextResponse.json({ error: "policy_draft_payload_too_large" }, { status: 413 });
      }
      chunks.push(result.value);
    }
    let body: Record<string, unknown> | null = null;
    try { body = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
    catch { return NextResponse.json({ error: "policy_draft_invalid_json" }, { status: 400 }); }
    const proposal = validateCatalogPolicyProposal(body?.proposal);
    if (!body || Object.keys(body).sort().join(",") !== "expectedRevision,proposal" ||
        !Number.isSafeInteger(body.expectedRevision) ||
        (body.expectedRevision as number) < 0 || (body.expectedRevision as number) >= 1000 ||
        !proposal)
      return NextResponse.json({ error: "policy_draft_invalid_request" }, { status: 400 });
    return inspectBundleDrift(request, context, null, null, false, true, {
      expectedRevision: body.expectedRevision as number, proposal,
    });
  }

  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return NextResponse.json({ error: "triage_json_required" }, { status: 415 });
  const len = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(len) || len < 0 || len > 1024)
    return NextResponse.json({ error: "triage_payload_too_large" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "triage_payload_missing" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let count = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    count += next.value.byteLength;
    if (count > 1024) {
      await reader.cancel("triage_payload_too_large");
      return NextResponse.json({ error: "triage_payload_too_large" }, { status: 413 });
    }
    chunks.push(next.value);
  }
  let body: Record<string, unknown> | null = null;
  try { body = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
  catch { return NextResponse.json({ error: "triage_invalid_json" }, { status: 400 }); }
  if (!body || Object.keys(body).sort().join(",") !== "observationToken,reasonCode,rowNumber" ||
      typeof body.rowNumber !== "number" || !Number.isSafeInteger(body.rowNumber) ||
      body.rowNumber < 1 || body.rowNumber > 999999999 ||
      typeof body.observationToken !== "string" || !/^[a-f0-9]{64}$/.test(body.observationToken) ||
      !validTriageReason(body.reasonCode))
    return NextResponse.json({ error: "triage_invalid_request" }, { status: 400 });
  return inspectBundleDrift(request, context, {
    rowNumber: body.rowNumber, observationToken: body.observationToken,
    reasonCode: body.reasonCode,
  });
}

/**
 * Independent domain expert disposition for an existing triage event.
 * A decision concerns the finding only. It cannot authorize clinical or
 * financial master activation, mutate imported rows, or amend released data.
 */
export async function PUT(request: NextRequest, context: Context) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return NextResponse.json({ error: "expert_json_required" }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 1024)
    return NextResponse.json({ error: "expert_request_too_large" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "expert_request_missing" }, { status: 400 });
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 1024) {
      await reader.cancel("expert_request_too_large");
      return NextResponse.json({ error: "expert_request_too_large" }, { status: 413 });
    }
    parts.push(chunk.value);
  }
  let data: Record<string, unknown> | null = null;
  try { data = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
  catch { return NextResponse.json({ error: "expert_invalid_json" }, { status: 400 }); }
  if (!data || Object.keys(data).sort().join(",") !== "disposition,flagEventId" ||
      typeof data.flagEventId !== "string" || !UUID.test(data.flagEventId) ||
      !validExpertDisposition(data.disposition))
    return NextResponse.json({ error: "expert_invalid_request" }, { status: 400 });
  return inspectBundleDrift(request, context, null, {
    flagEventId: data.flagEventId, disposition: data.disposition,
  });
}

async function inspectBundleDrift(
  request: NextRequest, { params }: Context,
  triage: TriageInput | null, expert: ExpertInput | null = null,
  expertPreflight = false,
  governance = false,
  policyDraftInput: PolicyDraftInput | null = null,
  mappingDiscussionRow: number | null = null,
  mappingDiscussionInput: MappingDiscussionInput | null = null,
) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sessionPermissions = permissionSet(session);
  if (!sessionPermissions.has("catalog.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const afterText = triage ? String(triage.rowNumber - 1)
    : request.nextUrl.searchParams.get("after") || "0";
  if (!/^(?:0|[1-9]\d{0,8})$/.test(afterText))
    return NextResponse.json({ error: "invalid_reconciliation_cursor" }, { status: 400 });
  const after = Number(afterText);
  const key = catalogBundleSigningSecret(process.env);
  if (!key) return NextResponse.json({ error: "review_observation_key_unavailable" }, { status: 503 });
  const { id: batchId } = await params;
  if (!UUID.test(batchId)) return NextResponse.json({ error: "bundle_review_not_found" }, { status: 404 });
  const organizationId = session.user.organizationId;
  const ctx = await requestContext();

  const outcome = await prisma.$transaction(async tx => {
    // Coordinate with existing same-tenant staged/master writers before live auth.
    const orgLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if (orgLock.length !== 1) return { error: "reconciliation_organization_inactive", httpStatus: 403 } as const;
    const batch = await tx.catalogImportBatch.findFirst({
      where: { id: batchId, organizationId, sourceType: BUNDLE_REVIEW_SOURCE,
        ...(expert ? {} : { createdByUserId: session.user.id }), status: "DRAFT" },
      select: { id: true, sourceType: true, sourceName: true, status: true,
        sourceChecksum: true, summary: true, createdByUserId: true },
    });
    if (!batch || !batch.sourceChecksum)
      return { error: "bundle_review_not_found", httpStatus: 404 } as const;
    if (expert && batch.createdByUserId === session.user.id)
      return { error: "independent_reviewer_required", httpStatus: 403 } as const;

    // Require both original session permissions and present persisted grants.
    const activeUser = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: {
        role: { include: { permissions: { include: { permission: true } } } },
      } } },
    });
    const livePermissions = new Set(activeUser?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(grant => grant.permission.code)) || []);
    const has = (code: string) => sessionPermissions.has(code) && livePermissions.has(code);
    if (!has("catalog.manage"))
      return { error: "reconciliation_permission_revoked", httpStatus: 403 } as const;
    const classes = await tx.catalogImportRow.groupBy({
      by: ["entityType"], where: { batchId: batch.id }, _count: { _all: true },
    });
    if (classes.some(item => !catalogExportTypes.has(item.entityType as CatalogExportType)))
      return { error: "reconciliation_invalid_entity", httpStatus: 409 } as const;
    if (!expert && classes.some(item => item.entityType === "REFERENCE_INTERVAL") &&
        !has("catalog.reference_ranges.manage"))
      return { error: "reconciliation_clinical_permission_revoked", httpStatus: 403 } as const;
    if (!expert && classes.some(item => item.entityType.startsWith("PRICE_")) && !has("pricing.manage"))
      return { error: "reconciliation_pricing_permission_revoked", httpStatus: 403 } as const;

    const liveBranch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, organizationId: true, status: true },
    });
    const branchGrants = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const initiallyGrantedBranches = new Set(session.user.branchScopes.filter(item =>
      item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
    ).map(item => item.branchId));
    const branchIds = branchGrants.map(item => item.branchId)
      .filter(id => initiallyGrantedBranches.has(id));
    const departmentGrants = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const initiallyGrantedDepartments = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restrictedDepartments = session.user.departmentScopes.length > 0;
    const currentDepartments = restrictedDepartments
      ? departmentGrants.filter(item => initiallyGrantedDepartments.has(item.departmentId))
      : departmentGrants;
    if (restrictedDepartments && !currentDepartments.length)
      return { error: "reconciliation_department_revoked", httpStatus: 403 } as const;
    const liveScope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: liveBranch,
      branchScopes: branchIds.map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: currentDepartments,
    });
    if (!liveScope)
      return { error: "reconciliation_clinical_scope_revoked", httpStatus: 403 } as const;

    // Authorize *all* 5k staged identities, not only the currently displayed page.
    const staged = await tx.catalogImportRow.findMany({
      where: { batchId: batch.id }, orderBy: { rowNumber: "asc" },
      select: { id: true, rowNumber: true, entityType: true, legacyKey: true,
        sourceData: true, normalizedData: true, validationIssues: true,
        status: true, importedEntityId: true },
    });
    if (!staged.length || staged.length > BUNDLE_REVIEW_MAX_ROWS ||
        staged.some(row => row.status !== "WARNING" || row.importedEntityId !== null))
      return { error: "reconciliation_batch_changed", httpStatus: 409 } as const;

    // Independent expert GET preflight and PUT disposition must not trust
    // freshly recomputed observation tokens over rewritten DRAFT rows.
    // Author-only drift diagnostics remain available for unqualified sources,
    // but they are not a qualified independent review or an apply action.
    if (expert || mappingDiscussionInput || mappingDiscussionRow !== null) {
      const metadata = reviewStageBatchMetadata(batch);
      const evidence = verifyIndependentExpertStage({
        context: {
          organizationId, batchId: batch.id, authorUserId: batch.createdByUserId,
          sourceChecksum: batch.sourceChecksum, rows: staged,
        },
        metadata, seal: record(batch.summary)?.stageEvidenceSeal,
        secret: key,
      });
      if (!evidence.ok)
        return { error: evidence.error, httpStatus: 409 } as const;
    }

    // A second reviewer may access only a previously flagged row and only
    // after full-batch tenant/branch/department checks. Do not expose source.
    const expertFlag = expert ? await tx.auditEvent.findFirst({
      where: { id: expert.flagEventId, organizationId,
        action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED",
        entityType: "CatalogImportRow" },
      select: { id: true, entityId: true, actorUserId: true, newValues: true },
    }) : null;
    const expertFlagData = record(expertFlag?.newValues);
    const expertRow = expertFlag ? staged.find(row => row.id === expertFlag.entityId) : null;
    if (expert && (!expertFlag || !expertRow ||
        expertFlagData?.batchId !== batch.id ||
        expertFlagData?.rowNumber !== expertRow.rowNumber ||
        expertFlagData?.entityType !== expertRow.entityType ||
        typeof expertFlagData?.evidenceToken !== "string")) {
      return { error: "expert_flag_not_found", httpStatus: 404 } as const;
    }

    const idsByType = new Map<CatalogExportType, string[]>();
    const testRefs = new Set<string>(), unitRefs = new Set<string>();
    const componentRefs = new Set<string>(), priceListRefs = new Set<string>();
    const packageRefs = new Set<string>();
    const activeBranchIds = new Set(branchIds);
    for (const row of staged) {
      const n = record(row.normalizedData), source = record(row.sourceData);
      const type = row.entityType as CatalogExportType;
      const id = n?.id;
      if (!n || !source || typeof id !== "string" || !UUID.test(id) ||
          source.id !== id || !catalogExportTypes.has(type))
        return { error: "reconciliation_source_identity_invalid", httpStatus: 409 } as const;
      const values = idsByType.get(type) || [];
      if (values.includes(id))
        return { error: "reconciliation_duplicate_identity", httpStatus: 409 } as const;
      values.push(id);
      idsByType.set(type, values);
      if (type === "PANEL" || type === "PACKAGE") {
        // Clinical membership is whole-list identity, including inactive and
        // off-branch test ids, never only those visible on the current page.
        if (!Array.isArray(n.items) || n.items.length === 0)
          return { error: "reconciliation_composite_membership_missing", httpStatus: 409 } as const;
        for (const item of n.items) {
          const member = record(item);
          if (!member || typeof member.testId !== "string" || !UUID.test(member.testId))
            return { error: "reconciliation_composite_member_invalid", httpStatus: 409 } as const;
          testRefs.add(member.testId);
        }
      }
      if (type === "PRICE_LIST_PACKAGE_ITEM") {
        if (typeof n.packageId !== "string" || !UUID.test(n.packageId))
          return { error: "reconciliation_package_identity_invalid", httpStatus: 409 } as const;
        packageRefs.add(n.packageId);
      }
      for (const [field, set] of [
        ["testId", testRefs], ["unitId", unitRefs],
        ["componentId", componentRefs], ["priceListId", priceListRefs],
      ] as const) {
        const value = n[field];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string" || !UUID.test(value))
          return { error: "reconciliation_parent_identity_invalid", httpStatus: 409 } as const;
        set.add(value);
      }
      if (n.branchId !== null && n.branchId !== undefined &&
          (typeof n.branchId !== "string" || !activeBranchIds.has(n.branchId)))
        return { error: "reconciliation_branch_scope_revoked", httpStatus: 403 } as const;
      if ((n.scopeType === "BRANCH" && !n.branchId) ||
          (n.scopeType === "ORGANIZATION" && n.branchId))
        return { error: "reconciliation_price_scope_invalid", httpStatus: 403 } as const;
    }
    const testScope = { ...clinicalImportTestWhere(liveScope), status: undefined };
    const branchScope = { OR: [{ branchId: null }, { branchId: { in: branchIds } }] };
    const genericPriceScope = { OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: branchIds } },
    ] };
    const fullyVisibleItems = {
      some: {},
      every: { test: testScope },
    };
    const [mappedTests, mappedUnits, mappedComponents, mappedLists, mappedPackages] = await Promise.all([
      tx.labTest.count({ where: { ...testScope, id: { in: [...testRefs] } } }),
      tx.unit.count({ where: { organizationId, id: { in: [...unitRefs] } } }),
      tx.testComponent.count({ where: { id: { in: [...componentRefs] }, test: testScope } }),
      tx.priceList.count({ where: { organizationId, ...genericPriceScope, id: { in: [...priceListRefs] } } }),
      tx.commercialPackage.count({ where: {
        organizationId, id: { in: [...packageRefs] }, items: fullyVisibleItems,
      } }),
    ]);
    if (mappedTests !== testRefs.size || mappedUnits !== unitRefs.size ||
        mappedComponents !== componentRefs.size || mappedLists !== priceListRefs.size ||
        mappedPackages !== packageRefs.size)
      return { error: "reconciliation_parent_scope_changed", httpStatus: 403 } as const;

    // Unknown groups must fail closed before generating observations.
    if ([...idsByType.keys()].some(type => !ordered.includes(type))) {
      return { error: "reconciliation_unsupported_source_group", httpStatus: 409 } as const;
    }
    const live = new Map<string, unknown>();
    for (const type of ordered) {
      const ids = idsByType.get(type) || [];
      if (!ids.length) continue;
      const base = { orderBy: { id: "asc" as const }, take: ids.length };
      const cursorScope = { id: { in: ids } };
      let records: Array<{ id: string }> = [];
  if (type === "TEST") {
    records = await tx.labTest.findMany({
      ...base, where: { ...testScope, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true, abbreviation: true,
        departmentId: true, specimenTypeId: true, containerId: true,
        methodId: true, defaultUnitId: true, resultType: true,
        workflowType: true, resultEntryLayout: true, decimalPrecision: true,
        minimumVolume: true, minimumVolumeUnit: true, assay: true,
        tatMinutes: true, loincCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "COMPONENT") {
    records = await tx.testComponent.findMany({
      ...base, where: { test: testScope, ...cursorScope },
      select: {
        id: true, testId: true, code: true, nameEn: true, nameAr: true,
        unitId: true, resultType: true, decimalPrecision: true,
        displayOrder: true, resultSectionId: true,
        reportNameEn: true, reportNameAr: true, reportDisplayOrder: true,
        reportVisible: true, entryWidth: true, entryHintEn: true, entryHintAr: true,
        status: true, createdAt: true, updatedAt: true, deactivatedAt: true,
        test: { select: { code: true } },
        unit: { select: { code: true, symbol: true } },
      },
    });
  } else if (type === "PANEL") {
    records = await tx.testPanel.findMany({
      ...base, where: { organizationId, items: fullyVisibleItems, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        descriptionEn: true, descriptionAr: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        items: { select: {
          testId: true, displayOrder: true, required: true,
          test: { select: { code: true } },
        }, orderBy: [{ displayOrder: "asc" }, { testId: "asc" }] },
      },
    });
  } else if (type === "PACKAGE") {
    records = await tx.commercialPackage.findMany({
      ...base, where: { organizationId, items: fullyVisibleItems, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        descriptionEn: true, descriptionAr: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        items: { select: {
          testId: true, displayOrder: true,
          test: { select: { code: true } },
        }, orderBy: [{ displayOrder: "asc" }, { testId: "asc" }] },
      },
    });
  } else if (type === "UNIT") {
    records = await tx.unit.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, symbol: true, nameEn: true, nameAr: true,
        ucumCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "CONTAINER") {
    records = await tx.container.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        tubeColor: true, additive: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "REFERENCE_INTERVAL") {
    records = await tx.referenceInterval.findMany({
      ...base, where: { component: { test: testScope }, ...branchScope, ...cursorScope },
      select: {
        id: true, componentId: true, branchId: true, methodId: true,
        analyzerId: true, specimenTypeId: true, sex: true, ageFrom: true,
        ageTo: true, ageUnit: true, pregnancyStatus: true,
        gestationalAgeFromWeeks: true, gestationalAgeToWeeks: true,
        populationCode: true, lowValue: true, highValue: true,
        normalTextEn: true, normalTextAr: true, criticalLow: true,
        criticalHigh: true, source: true, notes: true,
        effectiveFrom: true, effectiveTo: true, approvalStatus: true,
        status: true, approvedAt: true, retiredAt: true,
        createdAt: true, updatedAt: true,
        component: { select: { code: true, test: { select: { code: true } } } },
      },
    });
  } else if (type === "PRICE_LIST") {
    records = await tx.priceList.findMany({
      ...base, where: { organizationId, ...genericPriceScope, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true, scopeType: true,
        branchId: true, sourceId: true, referrerId: true, clientId: true,
        contractId: true, currency: true, priority: true, effectiveFrom: true,
        effectiveTo: true, status: true, createdAt: true, updatedAt: true,
        deactivatedAt: true,
      },
    });
  } else if (type === "PRICE_LIST_PACKAGE_ITEM") {
    records = await tx.priceListPackageItem.findMany({
      ...base, where: {
        ...cursorScope,
        package: { organizationId, items: fullyVisibleItems },
        priceList: { organizationId, ...genericPriceScope,
          sourceId: null, referrerId: null, clientId: null, contractId: null },
      },
      select: {
        id: true, priceListId: true, packageId: true, unitPrice: true,
        effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        package: { select: { code: true } },
        priceList: { select: {
          code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true,
        } },
      },
    });
  } else if (type === "PRICE_LIST_ITEM") {
    records = await tx.priceListItem.findMany({
      ...base,
      where: { priceList: { organizationId, ...genericPriceScope }, test: testScope, ...cursorScope },
      select: {
        id: true, priceListId: true, testId: true, unitPrice: true,
        effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        test: { select: { code: true } },
        priceList: { select: {
          code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true,
        } },
      },
    });
  }



      if (records.length !== ids.length)
        return { error: "reconciliation_live_master_scope_changed", httpStatus: 403 } as const;
      for (const current of records) live.set(type + ":" + current.id, current);
    }
    const requestedMappingRow=mappingDiscussionInput?.rowNumber ?? mappingDiscussionRow;
    const pageAfter = expertRow ? expertRow.rowNumber - 1 :
      requestedMappingRow !== null && requestedMappingRow !== undefined
        ? requestedMappingRow - 1 : after;
    const page = governance
      ? staged : staged.filter(row => row.rowNumber > pageAfter).slice(0, PAGE_SIZE + 1);
    const shown = governance ? page : page.slice(0, PAGE_SIZE);
    if (shown.some(row => !live.has(row.entityType + ":" + String(record(row.normalizedData)?.id || "")))) {
      return { error: "reconciliation_live_master_scope_changed", httpStatus: 403 } as const;
    }
    const rows = shown.map(row => {
      const id = String(record(row.normalizedData)?.id || "");
      const value = live.get(row.entityType + ":" + id);
      // Date/Decimal values must match Stage 50/51 JSON wire serialization.
      const currentJson: unknown = JSON.parse(JSON.stringify(value));
      const observationToken = catalogDriftObservationToken(
        key, batch.sourceChecksum!, row.rowNumber, row.entityType, row.sourceData, currentJson
      );
      const differences = catalogBundleDrift(row.sourceData, currentJson);
      return {
        rowNumber: row.rowNumber, entityType: row.entityType,
        ...differences,
        fieldReview: classifyCatalogReviewDrift(
          row.entityType, differences.changedFields, differences.additionalFieldsOmitted),
        targetIdentity: observeCatalogTargetIdentity(row.entityType, row.sourceData, currentJson),
        observationToken,
      };
    });
    const auditHistory = await tx.auditEvent.findMany({
      where: {
        organizationId, entityType: "CatalogImportRow",
        action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED",
        entityId: { in: shown.map(row => row.id) },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: governance ? 25001 : 1001,
      select: { id: true, entityId: true, actorUserId: true, newValues: true, occurredAt: true },
    });
    // A truncated audit history can hide the latest authentic referral.
    if (auditHistory.length > (governance ? 25000 : 1000))
      return { error: "review_history_limit_exceeded", httpStatus: 409 } as const;
    const lastFlag = new Map<string, {
      id: string; reasonCode: string; category: string; occurredAt: string;
      evidenceToken: string;
    }>();
    for (const event of auditHistory) {
      if (lastFlag.has(event.entityId)) continue;
      const data = record(event.newValues);
      if (typeof data?.reasonCode !== "string" || typeof data?.category !== "string" ||
          typeof data?.evidenceToken !== "string")
        return { error: "review_history_corrupt", httpStatus: 409 } as const;
      lastFlag.set(event.entityId, {
        id: event.id, reasonCode: data.reasonCode, category: data.category,
        occurredAt: event.occurredAt.toISOString(), evidenceToken: data.evidenceToken,
      });
    }
    const latestIds = [...lastFlag.values()].map(item => item.id);
    const decisions = latestIds.length ? await tx.auditEvent.findMany({
      where: {
        organizationId, action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED",
        entityType: "CatalogExpertReviewFlag", entityId: { in: latestIds },
      },
      select: { entityId: true, newValues: true },
      take: latestIds.length + 1,
    }) : [];
    if (decisions.length > latestIds.length)
      return { error: "review_decision_integrity_error", httpStatus: 409 } as const;
    const latestDecisions = new Map<string, string>();
    for (const event of decisions) {
      if (latestDecisions.has(event.entityId))
        return { error: "review_decision_integrity_error", httpStatus: 409 } as const;
      const data = record(event.newValues);
      if (data?.disposition !== "CONFIRM_FINDING" &&
          data?.disposition !== "RETURN_FOR_CORRECTION")
        return { error: "review_decision_integrity_error", httpStatus: 409 } as const;
      latestDecisions.set(event.entityId, data.disposition);
    }
    const verifiedSource = record(batch.summary)?.attestationStatus === "VERIFIED";
    const displayed = rows.map((row, index) => {
      const flag = lastFlag.get(shown[index].id);
      const finding = resolveFindingLifecycle(flag ? {
        evidenceToken: flag.evidenceToken,
        currentObservation: row.observationToken,
        decision: latestDecisions.get(flag.id) || null,
      } : null);
      return {
        ...row, finding,
        latestFlag: flag ? {
          reasonCode: flag.reasonCode, category: flag.category, occurredAt: flag.occurredAt,
        } : null,
      };
    });
    if (requestedMappingRow !== null && requestedMappingRow !== undefined) {
      const index = shown.findIndex(row => row.rowNumber === requestedMappingRow);
      if (index < 0)
        return { error:"mapping_discussion_row_not_found", httpStatus:404 } as const;
      const observed=rows[index];
      const identity=observed.targetIdentity;
      const stagedRow=shown[index];
      const context={
        organizationId,batchId:batch.id,branchId:liveScope.branchId,
        rowId:stagedRow.id,authorUserId:batch.createdByUserId,
        sourceChecksum:batch.sourceChecksum,
        rowNumber:observed.rowNumber,entityType:observed.entityType,
      };
      // A history from a wrong actor/branch, including an older revision,
      // must not vanish behind a newer well-formed event.
      const historyRows=await tx.auditEvent.findMany({
        where:{
          organizationId,entityType:"CatalogImportRow",entityId:stagedRow.id,
          action:"CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED",
        },
        orderBy:[{occurredAt:"desc"},{id:"desc"}],
        take:MAPPING_DISCUSSION_HISTORY_LIMIT+1,
        select:{id:true,actorUserId:true,branchId:true,newValues:true},
      });
      const history=verifyMappingDiscussionHistory({context,events:historyRows});
      if(!history)
        return {error:"mapping_discussion_history_corrupt",httpStatus:409} as const;
      const previous=history.draft;
      const current=mappingDiscussionCurrent(previous,observed.observationToken);
      if(mappingDiscussionInput) {
        if (!matchesCatalogDriftObservation(
          mappingDiscussionInput.observationToken,observed.observationToken))
          return {error:"mapping_discussion_evidence_stale",httpStatus:409} as const;
        if (mappingDiscussionInput.expectedRevision!==history.revision)
          return {error:"mapping_discussion_revision_conflict",httpStatus:409} as const;
        if(mappingDiscussionInput.intent==="PROPOSE_LOCAL_RECONCILIATION" &&
            identity.status!=="LOCAL_IDENTITY_OBSERVED")
          return {error:"mapping_discussion_local_identity_not_observed",httpStatus:409} as const;
        if(previous && current && previous.intent===mappingDiscussionInput.intent)
          return {status:"MAPPING_DISCUSSION_UNCHANGED",revision:history.revision,
            intent:previous.intent,current:true,reviewOnly:true,approved:false,
            mappingApproved:false,signingEnabled:false,activated:false,
            liveWrites:false} as const;
        if(history.revision>=MAPPING_DISCUSSION_HISTORY_LIMIT)
          return {error:"mapping_discussion_revision_limit",httpStatus:409} as const;
        const next=createMappingDiscussionDraft(context,{
          revision:history.revision+1,
          previousDigest:previous?.digest ?? null,
          observationToken:observed.observationToken,
          intent:mappingDiscussionInput.intent,
        });
        await tx.auditEvent.create({data:{
          organizationId,branchId:liveScope.branchId,actorUserId:session.user.id,
          action:"CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED",
          entityType:"CatalogImportRow",entityId:stagedRow.id,newValues:next,
          ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
        return {status:"MAPPING_DISCUSSION_DRAFT_RECORDED",
          revision:next.revision,intent:next.intent,current:true,
          reviewOnly:true,approved:false,mappingApproved:false,
          signingEnabled:false,activated:false,liveWrites:false} as const;
      }
      return {status:previous?"MAPPING_DISCUSSION_DRAFT":"MAPPING_DISCUSSION_NOT_STARTED",
        revision:history.revision,intent:previous?.intent ?? null,
        current,localIdentityObserved:identity.status==="LOCAL_IDENTITY_OBSERVED",
        reviewOnly:true,approved:false,mappingApproved:false,
        signingEnabled:false,activated:false,liveWrites:false} as const;
    }
    if (expert) {
      const index = shown.findIndex(row => row.id === expertRow!.id);
      if (index < 0) return { error: "expert_row_not_found", httpStatus: 404 } as const;
      const observed = rows[index];
      const latestFlag = await tx.auditEvent.findFirst({
        where: { organizationId, action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED",
          entityType: "CatalogImportRow", entityId: expertRow!.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const policy = expertDispositionAllowed({
        expertUserId: session.user.id,
        batchAuthorId: batch.createdByUserId,
        flagActorUserId: expertFlag!.actorUserId,
        eventCategory: expertFlagData?.category,
        entityType: observed.entityType,
        flaggedEvidence: expertFlagData?.evidenceToken,
        latestEvidence: observed.observationToken,
        sessionPermissions, livePermissions,
        isLatestFlag: latestFlag?.id === expertFlag!.id,
        isOpenDraft: true,
      });
      if (!policy.allowed) {
        return { error: policy.reason,
          httpStatus: policy.reason === "expert_evidence_stale" ? 409 : 403 } as const;
      }
      const priorDecision = await tx.auditEvent.findFirst({
        where: { organizationId, action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED",
          entityType: "CatalogExpertReviewFlag", entityId: expertFlag!.id },
        select: { id: true, newValues: true },
      });
      if (priorDecision) {
        const old = record(priorDecision.newValues);
        if (old?.disposition !== "CONFIRM_FINDING" &&
            old?.disposition !== "RETURN_FOR_CORRECTION")
          return { error: "expert_decision_integrity_error", httpStatus: 409 } as const;
        if (!expertPreflight && old.disposition !== expert.disposition)
          return { error: "expert_decision_conflict", httpStatus: 409 } as const;
        return {
          status: "EXPERT_DECISION_ALREADY_RECORDED", category: policy.category,
          disposition: old.disposition, approved: false, activated: false, liveWrites: false,
        } as const;
      }
      if (expertPreflight) return {
        status: "EXPERT_REVIEW_READY", category: policy.category,
        rowNumber: observed.rowNumber, disposition: null,
        sourceVerified: verifiedSource,
        approved: false, activated: false, liveWrites: false,
      } as const;
      await tx.auditEvent.create({ data: {
        organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
        action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED",
        entityType: "CatalogExpertReviewFlag", entityId: expertFlag!.id,
        newValues: {
          batchId: batch.id, rowId: expertRow!.id,
          rowNumber: observed.rowNumber, entityType: observed.entityType,
          category: policy.category, disposition: expert.disposition,
          evidenceToken: observed.observationToken, sourceVerified: verifiedSource,
          reviewOnly: true, approved: false, activated: false,
        },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return {
        status: "EXPERT_DECISION_RECORDED", category: policy.category,
        disposition: expert.disposition, rowNumber: observed.rowNumber,
        approved: false, activated: false, liveWrites: false,
      } as const;
    }
    if (triage) {
      const index = shown.findIndex(row => row.rowNumber === triage.rowNumber);
      if (index < 0) return { error: "triage_row_not_found", httpStatus: 404 } as const;
      const observed = rows[index];
      const category = bundleTriageClass(observed.entityType);
      if (!category || !triagePermissionScope(category, livePermissions) ||
          !triagePermissionScope(category, sessionPermissions))
        return { error: "triage_domain_permission_required", httpStatus: 403 } as const;
      if (!matchesCatalogDriftObservation(triage.observationToken, observed.observationToken))
        return { error: "triage_stale_observation", httpStatus: 409 } as const;
      if (triage.reasonCode === "SOURCE_VALUE_CHANGED" && observed.disposition !== "DRIFTED")
        return { error: "triage_reason_incompatible", httpStatus: 409 } as const;
      const existingFlag = lastFlag.get(shown[index].id);
      const resubmission = triageResubmission(existingFlag ? {
        evidenceToken: existingFlag.evidenceToken,
        currentObservation: observed.observationToken,
        decision: latestDecisions.get(existingFlag.id) || null,
      } : null, triage.reasonCode, existingFlag?.reasonCode);
      if (resubmission === "ALREADY_FLAGGED") {
        return {
          status: "ALREADY_FLAGGED_FOR_EXPERT_REVIEW", category,
          rowNumber: observed.rowNumber, reasonCode: triage.reasonCode,
          disposition: observed.disposition, approved: false, activated: false,
          liveWrites: false,
        } as const;
      }
      if (resubmission === "ALREADY_PENDING")
        return { error: "triage_already_pending_expert", httpStatus: 409 } as const;
      if (resubmission === "DECIDED")
        return { error: "triage_decided_new_observation_required", httpStatus: 409 } as const;
      await tx.auditEvent.create({ data: {
        organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
        action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED", entityType: "CatalogImportRow",
        entityId: shown[index].id,
        newValues: {
          batchId: batch.id, rowNumber: observed.rowNumber, entityType: observed.entityType,
          category, reasonCode: triage.reasonCode, disposition: observed.disposition,
          changedFields: observed.changedFields,
          additionalFieldsOmitted: observed.additionalFieldsOmitted,
          evidenceToken: observed.observationToken,
          sourceVerified: record(batch.summary)?.attestationStatus === "VERIFIED",
          reviewOnly: true, approved: false, activated: false,
        },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return {
        status: "FLAGGED_FOR_EXPERT_REVIEW", category, rowNumber: observed.rowNumber,
        reasonCode: triage.reasonCode, disposition: observed.disposition,
        approved: false, activated: false, liveWrites: false,
      } as const;
    }
    const verified = record(batch.summary)?.attestationStatus === "VERIFIED";
    if (governance) {
      // All scoped records and the latest audit histories were loaded in
      // this same repeatable-read transaction. Only bounded COUNTS leave it.
      const readiness = summarizeCatalogGovernance(displayed, verified);
      // Planning only. Existing management grants are NOT signatory credentials.
      // No identities, role names, passwords or personnel details leave this API.
      const potentialReviewers = await tx.user.findMany({
        where: { organizationId, status: "ACTIVE" },
        take: 1001,
        select: {
          id: true, status: true, mfaEnabled: true,
          roles: { select: { role: { select: {
            organizationId: true, status: true,
            permissions: { select: { permission: { select: { code: true } } } },
          } } } },
          branchScopes: { select: {
            branchId: true, branch: { select: { status: true, organizationId: true } },
          } },
          departmentScopes: { select: { department: { select: {
            status: true, organizationId: true, branchId: true,
          } } } },
        },
      });
      if (potentialReviewers.length > 1000)
        return { error: "signatory_planning_user_limit_exceeded", httpStatus: 409 } as const;
      const planning = summarizeSignatoryPlanning({
        authorId: batch.createdByUserId, branchId: liveScope.branchId,
        candidates: potentialReviewers.map(candidate => ({
          id: candidate.id, status: candidate.status, mfaEnabled: candidate.mfaEnabled,
          activeBranchIds: candidate.branchScopes.filter(scope =>
            scope.branch.status === "ACTIVE" && scope.branch.organizationId === organizationId
          ).map(scope => scope.branchId),
          hasRestrictedDepartments: candidate.departmentScopes.length > 0,
          hasActiveApplicableDepartment: candidate.departmentScopes.some(scope =>
            scope.department.status === "ACTIVE" &&
            scope.department.organizationId === organizationId &&
            (scope.department.branchId === null ||
              scope.department.branchId === liveScope.branchId)
          ),
          permissions: new Set(candidate.roles.filter(grant =>
            grant.role.status === "ACTIVE" &&
            grant.role.organizationId === organizationId
          ).flatMap(grant => grant.role.permissions.map(permission =>
            permission.permission.code
          ))),
        })),
      });
      const policyContext = {
        organizationId, batchId: batch.id, branchId: liveScope.branchId,
        sourceChecksum: batch.sourceChecksum,
      };
      // Examine the entire bounded audit revision chain, including events
      // by unexpected actors; a valid latest digest cannot hide older damage.
      const policyEvents = await tx.auditEvent.findMany({
        where: {
          organizationId,
          entityType: "CatalogImportBatch", entityId: batch.id,
          action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: POLICY_DRAFT_HISTORY_LIMIT + 1,
        select: { id: true, actorUserId: true, branchId: true, newValues: true },
      });
      const policyHistory = verifyBranchScopedPolicyDraftHistory({
        events: policyEvents, authorUserId: batch.createdByUserId,
        ...policyContext,
      });
      if (!policyHistory)
        return { error: "policy_draft_history_corrupt", httpStatus: 409 } as const;
      const oldPolicy = policyHistory.draft;
      let currentPolicy = oldPolicy;
      let currentPolicyEventId = policyHistory.latestEventId;
      let draftSave: "UNCHANGED" | "RECORDED" | null = null;
      if (policyDraftInput) {
        if (policyDraftInput.expectedRevision !== (oldPolicy?.revision || 0))
          return { error: "policy_draft_revision_conflict", httpStatus: 409 } as const;
        // An unchanged revision stays idempotent even at the 1,000-revision cap.
        const unchanged = oldPolicy?.proposalDigest === catalogPolicyDraftDigest({
          ...policyContext, proposal: policyDraftInput.proposal,
        });
        if (unchanged) {
          draftSave = "UNCHANGED";
        } else {
          if (policyHistory.revisionCount >= POLICY_DRAFT_HISTORY_LIMIT)
            return { error: "policy_draft_revision_limit", httpStatus: 409 } as const;
          const next = createPolicyDraftLedgerEntry(
            policyContext, policyDraftInput.proposal, (oldPolicy?.revision || 0) + 1,
          );
          const recordedDraft = await tx.auditEvent.create({ data: {
            organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
            action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
            entityType: "CatalogImportBatch", entityId: batch.id,
            newValues: next,
            ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
          }, select: { id: true } });
          currentPolicyEventId = recordedDraft.id;
          currentPolicy = next;
          draftSave = "RECORDED";
        }
      }
      // Read exactly the latest revision's review AuditEvents. Old reviews
      // remain in history but never count for the new proposal.
      const reviewEvents = currentPolicyEventId ? await tx.auditEvent.findMany({
        where: {
          organizationId,
          action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
          entityType: "CatalogPolicyDraft", entityId: currentPolicyEventId,
        },
        select: { actorUserId: true, branchId: true, newValues: true }, take: 3,
      }) : [];
      if (!policyAuditBranchesMatch(reviewEvents, liveScope.branchId))
        return { error: "policy_draft_review_history_corrupt", httpStatus: 409 } as const;
      const reviewFeedback = currentPolicy && currentPolicyEventId
        ? policyDraftAuthorFeedback({
            draftEventId: currentPolicyEventId, draft: currentPolicy,
            authorUserId: batch.createdByUserId, events: reviewEvents,
          }) : null;
      if (currentPolicy && !reviewFeedback)
        return { error: "policy_draft_review_history_corrupt", httpStatus: 409 } as const;
      // Return choices and revision only; ledger identity and source details
      // stay inside the immutable audit record and never reach the browser.
      const proposalView = currentPolicy ? {
        revision: currentPolicy.revision,
        proposal: currentPolicy.proposal,
        proposalDigest: currentPolicy.proposalDigest,
        state: "UNAPPROVED_DRAFT" as const,
        reviewOnly: true as const, approved: false as const,
        signingEnabled: false as const, activated: false as const,
        liveWrites: false as const,
      } : null;
      await tx.auditEvent.create({ data: {
        organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
        action: "CATALOG_BUNDLE_GOVERNANCE_INSPECTED", entityType: "CatalogImportBatch",
        entityId: batch.id, newValues: {
          rowCount: readiness.rowCount, sourceAttested: verified, blockers: readiness.blockers,
          planningGaps: planning.gaps,
          policyDraftRevision: currentPolicy?.revision || 0,
          policyDraftState: currentPolicy ? "UNAPPROVED_DRAFT" : "NOT_STARTED",
          planningReviewerCounts: {
            clinical: planning.clinicalReviewerCandidates,
            financial: planning.financialReviewerCandidates,
            crossQualified: planning.crossQualifiedReviewers,
          },
          readOnly: true, approved: false, activated: false,
        }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { ...readiness, signatoryPlanning: planning,
        policyDraft: proposalView, policyDraftSave: draftSave,
        policyReviewFeedback: reviewFeedback };
    }
    await tx.auditEvent.create({ data: {
      organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
      action: "CATALOG_BUNDLE_DRIFT_REVIEWED", entityType: "CatalogImportBatch",
      entityId: batch.id, newValues: {
        displayed: rows.length, after, changed: rows.filter(r => r.disposition === "DRIFTED").length,
        sourceVerified: verified, readOnly: true,
      }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { rows: displayed, hasMore: page.length > PAGE_SIZE,
      nextCursor: page.length > PAGE_SIZE ? shown[shown.length - 1].rowNumber : null,
      sourceVerified: verified, liveWrites: false, clinicalActivation: false,
      priceActivation: false, approvalRequired: true, reviewedAt: new Date().toISOString(),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in outcome)
    return NextResponse.json({ error: outcome.error }, {
      status: outcome.httpStatus, headers: { "Cache-Control": "private, no-store" },
    });
  return NextResponse.json(outcome, { headers: { "Cache-Control": "private, no-store" } });
}
