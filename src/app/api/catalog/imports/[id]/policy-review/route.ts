import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BUNDLE_REVIEW_SOURCE } from "@/lib/catalog-bundle-review";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { validatePolicyReviewBatchScope } from "@/lib/catalog-policy-review-scope";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import { reviewStageBatchMetadata } from "@/lib/catalog-review-stage-evidence";
import {
  POLICY_DRAFT_HISTORY_LIMIT, verifyBranchScopedPolicyDraftHistory,
  policyAuditBranchesMatch,
} from "@/lib/catalog-policy-draft-history";
import {
  domainReviewPermissions, nextPolicyReviewRecord, parsePolicyReviewRecord,
  validPolicyReviewDisposition, validPolicyReviewDomain,
  validPolicyReviewReason, type PolicyReviewDisposition, type PolicyReviewDomain,
  type PolicyReviewReason,
} from "@/lib/catalog-policy-draft-review";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
type RequestInput = {
  draftEventId: string; domain: PolicyReviewDomain;
  disposition: PolicyReviewDisposition | null; reasonCode: PolicyReviewReason | null;
};
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

export async function GET(request: NextRequest, context: Context) {
  const params = request.nextUrl.searchParams;
  const draftEventId = params.get("draftEventId");
  const domain = params.get("domain");
  if ([...params.keys()].sort().join(",") !== "domain,draftEventId" ||
      !draftEventId || !UUID.test(draftEventId) || !validPolicyReviewDomain(domain))
    return NextResponse.json({ error: "policy_review_invalid_request" }, { status: 400 });
  return inspectPolicyReview(request, context, {
    draftEventId, domain, disposition: null, reasonCode: null,
  });
}

export async function POST(request: NextRequest, context: Context) {
  if ([...request.nextUrl.searchParams.keys()].length)
    return NextResponse.json({ error: "policy_review_invalid_query" }, { status: 400 });
  if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !==
      "application/json")
    return NextResponse.json({ error: "policy_review_json_required" }, { status: 415 });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return NextResponse.json({ error: "policy_review_cross_site_request" }, { status: 403 });
  const reportedSize = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(reportedSize) || reportedSize < 0 || reportedSize > 1024)
    return NextResponse.json({ error: "policy_review_payload_too_large" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "policy_review_payload_missing" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > 1024) {
      await reader.cancel("policy_review_payload_too_large");
      return NextResponse.json({ error: "policy_review_payload_too_large" }, { status: 413 });
    }
    chunks.push(item.value);
  }
  let body: Record<string, unknown> | null = null;
  try { body = asObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
  catch { return NextResponse.json({ error: "policy_review_invalid_json" }, { status: 400 }); }
  if (!body || Object.keys(body).sort().join(",") !==
        "disposition,domain,draftEventId,reasonCode" ||
      typeof body.draftEventId !== "string" || !UUID.test(body.draftEventId) ||
      !validPolicyReviewDomain(body.domain) ||
      !validPolicyReviewDisposition(body.disposition) ||
      !validPolicyReviewReason(body.domain, body.disposition, body.reasonCode))
    return NextResponse.json({ error: "policy_review_invalid_request" }, { status: 400 });
  return inspectPolicyReview(request, context, {
    draftEventId: body.draftEventId, domain: body.domain,
    disposition: body.disposition, reasonCode: body.reasonCode as PolicyReviewReason,
  });
}

async function inspectPolicyReview(request: NextRequest, { params }: Context, input: RequestInput) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const originalPermissions = permissionSet(session);
  if (!domainReviewPermissions(input.domain, originalPermissions))
    return NextResponse.json({ error: "policy_review_domain_permission_required" }, { status: 403 });
  const { id: batchId } = await params;
  if (!UUID.test(batchId)) return NextResponse.json({ error: "policy_review_not_found" }, { status: 404 });
  const organizationId = session.user.organizationId;
  const ctx = await requestContext();
  const result = await prisma.$transaction(async tx => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
    `;
    if (!locked) return { error: "policy_review_organization_inactive", httpStatus: 403 } as const;
    const activeUser = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: { role: { include: {
        permissions: { include: { permission: true } },
      } } } } },
    });
    const currentPermissions = new Set(activeUser?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(grant => grant.permission.code)) || []);
    if (!domainReviewPermissions(input.domain, currentPermissions))
      return { error: "policy_review_domain_permission_revoked", httpStatus: 403 } as const;
    const branch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, status: true, organizationId: true },
    });
    const branchGrants = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const originalBranches = new Set(session.user.branchScopes.filter(item =>
      item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
    ).map(item => item.branchId));
    const departments = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const originalDepartments = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restrictedDepartments = session.user.departmentScopes.length > 0;
    const matchingDepartments = restrictedDepartments
      ? departments.filter(item => originalDepartments.has(item.departmentId))
      : departments;
    if (restrictedDepartments && !matchingDepartments.length)
      return { error: "policy_review_department_revoked", httpStatus: 403 } as const;
    const grantedBranchIds = branchGrants.filter(item => originalBranches.has(item.branchId))
      .map(item => item.branchId);
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: branch,
      branchScopes: grantedBranchIds.map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: matchingDepartments,
    });
    if (!scope) return { error: "policy_review_branch_scope_revoked", httpStatus: 403 } as const;

    const batch = await tx.catalogImportBatch.findFirst({
      where: { id: batchId, organizationId, sourceType: BUNDLE_REVIEW_SOURCE, status: "DRAFT" },
      select: { id: true, sourceType: true, sourceName: true, status: true,
        sourceChecksum: true, createdByUserId: true, summary: true },
    });
    if (!batch?.sourceChecksum)
      return { error: "policy_review_not_found", httpStatus: 404 } as const;
    if (batch.createdByUserId === session.user.id)
      return { error: "policy_review_independent_reviewer_required", httpStatus: 403 } as const;
    const draftEvents = await tx.auditEvent.findMany({
      where: { organizationId,
        entityType: "CatalogImportBatch", entityId: batch.id,
        action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED" },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: POLICY_DRAFT_HISTORY_LIMIT + 1,
      select: { id: true, actorUserId: true, branchId: true, newValues: true },
    });
    const history = verifyBranchScopedPolicyDraftHistory({
      events: draftEvents, authorUserId: batch.createdByUserId,
      organizationId, batchId: batch.id, branchId: scope.branchId,
      sourceChecksum: batch.sourceChecksum,
    });
    if (!history)
      return { error: "policy_review_draft_integrity_error", httpStatus: 409 } as const;
    const latest = history.latestEventId ? { id: history.latestEventId } : null;
    if (!latest || latest.id !== input.draftEventId)
      return { error: "policy_review_stale_revision", httpStatus: 409 } as const;
    const draft = history.draft!;

    // Preflight and POST recheck every staged identity under the same tenant lock.
    // A domain reviewer cannot make a procedural statement about out-of-scope masters.
    const batchScope = await validatePolicyReviewBatchScope(tx, {
      batchId: batch.id, scope, grantedBranchIds,
      sourceChecksum: batch.sourceChecksum, authorUserId: batch.createdByUserId,
      stageEvidenceSeal: batch.summary && typeof batch.summary === "object" &&
        !Array.isArray(batch.summary) ? batch.summary.stageEvidenceSeal : null,
      batchMetadata: reviewStageBatchMetadata(batch),
      signingSecret: catalogBundleSigningSecret(process.env),
    });
    if (!batchScope.ok)
      return { error: batchScope.error, httpStatus: 403 } as const;
    const recorded = await tx.auditEvent.findMany({
      where: { organizationId,
        action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
        entityType: "CatalogPolicyDraft", entityId: latest.id },
      select: { actorUserId: true, branchId: true, newValues: true },
      take: 3,
    });
    if (recorded.length > 2 || !policyAuditBranchesMatch(recorded, scope.branchId))
      return { error: "policy_review_history_integrity_error", httpStatus: 409 } as const;
    const prior = recorded.map(row => ({
      actorUserId: row.actorUserId,
      decision: parsePolicyReviewRecord(row.newValues, {
        draftEventId: latest.id, draft,
      }),
    }));
    if (prior.some(item => !item.decision || !item.actorUserId ||
        item.actorUserId === batch.createdByUserId) ||
        new Set(prior.map(item => item.decision?.domain)).size !== prior.length ||
        new Set(prior.map(item => item.actorUserId)).size !== prior.length)
      return { error: "policy_review_history_integrity_error", httpStatus: 409 } as const;

    const other = prior.find(item => item.decision?.domain !== input.domain);
    const same = prior.find(item => item.decision?.domain === input.domain);
    if (other?.actorUserId === session.user.id)
      return { error: "policy_review_distinct_reviewers_required", httpStatus: 403 } as const;
    if (same) {
      if (!input.disposition) return {
        status: "ALREADY_REVIEWED", domain: input.domain, revision: draft.revision,
        reviewOnly: true, approved: false, activated: false, liveWrites: false,
        signingEnabled: false,
      } as const;
      if (same.actorUserId === session.user.id &&
          same.decision?.disposition === input.disposition &&
          same.decision.reasonCode === input.reasonCode)
        return { status: "ALREADY_RECORDED", domain: input.domain,
          revision: draft.revision, reviewOnly: true, approved: false,
          activated: false, liveWrites: false, signingEnabled: false } as const;
      return { error: "policy_review_decision_conflict", httpStatus: 409 } as const;
    }
    if (!input.disposition) return {
      status: "POLICY_DRAFT_REVIEW_READY", domain: input.domain,
      draftEventId: latest.id, revision: draft.revision, proposal: draft.proposal,
      proposalDigest: draft.proposalDigest, reviewOnly: true, approved: false,
      signingEnabled: false, activated: false, liveWrites: false,
    } as const;
    const decision = nextPolicyReviewRecord({
      draftEventId: latest.id, draft, domain: input.domain,
      disposition: input.disposition, reasonCode: input.reasonCode!,
    });
    await tx.auditEvent.create({ data: {
      organizationId, branchId: scope.branchId, actorUserId: session.user.id,
      action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
      entityType: "CatalogPolicyDraft", entityId: latest.id,
      newValues: decision, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return {
      status: "POLICY_DRAFT_REVIEW_RECORDED", domain: input.domain,
      revision: draft.revision, disposition: input.disposition,
      reviewOnly: true, approved: false, signingEnabled: false,
      activated: false, liveWrites: false,
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in result) return NextResponse.json({ error: result.error }, {
    status: result.httpStatus, headers: { "Cache-Control": "private, no-store" },
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
