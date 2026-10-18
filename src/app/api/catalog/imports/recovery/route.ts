import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveCatalogReviewStagingAuthority } from "@/lib/catalog-review-staging-auth";
import { catalogStageSubmissionKey } from "@/lib/catalog-stage-idempotency";
import { isRecoverableStageSource } from "@/lib/catalog-stage-recovery";

const noStore = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Read-only reconciliation of a LOST staging response. No POST/replay, import,
 * approval or access to row contents is possible through this endpoint.
 * Scope and author must be live, not merely copied from an old browser session.
 */
export async function GET(request: Request) {
  const session = await requirePermission("catalog.manage");
  const params = new URL(request.url).searchParams;
  const sourceType = params.get("sourceType");
  const key = catalogStageSubmissionKey(params.get("key"));
  if (!isRecoverableStageSource(sourceType) || !key.valid || !key.key)
    return NextResponse.json({ error: "invalid_staging_recovery_request" },
      { status: 400, headers: noStore });

  const result = await prisma.$transaction(async tx => {
    // Serialize with staging and permission-dependent master operations.
    const active = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${session.user.organizationId}
        AND status = 'ACTIVE' FOR UPDATE
    `;
    if (active.length !== 1) return { kind: "denied" } as const;
    const batch = await tx.catalogImportBatch.findFirst({
      where: {
        organizationId: session.user.organizationId,
        createdByUserId: session.user.id,
        sourceType,
        submissionKey: key.key,
      },
      select: { id: true },
    });
    // Do not distinguish foreign keys or keys that have not yet committed.
    if (!batch) return { kind: "absent" } as const;

    const kinds = await tx.catalogImportRow.groupBy({
      by: ["entityType"], where: { batchId: batch.id },
    });
    const types = kinds.map(row => row.entityType);
    const live = await liveCatalogReviewStagingAuthority(tx, {
      userId: session.user.id,
      organizationId: session.user.organizationId,
      activeBranchId: session.activeBranchId || "",
      sessionBranchIds: session.user.branchScopes.filter(grant =>
        grant.branch.organizationId === session.user.organizationId &&
        grant.branch.status === "ACTIVE").map(grant => grant.branchId),
      sessionDepartmentIds: session.user.departmentScopes.map(grant => grant.departmentId),
      needsPricing: types.some(type => type.startsWith("PRICE_")),
      needsRanges: types.includes("REFERENCE_INTERVAL"),
      needsClinicalScope: sourceType === "CONFIG_BUNDLE_REVIEW" ||
        types.some(type => !["UNIT", "CONTAINER"].includes(type)),
    });
    if (!live) return { kind: "denied" } as const;
    return { kind: "found", id: batch.id } as const;
  }, { timeout: 30000 });

  if (result.kind === "denied")
    return NextResponse.json({ error: "staging_recovery_authority_revoked" },
      { status: 403, headers: noStore });
  if (result.kind === "absent")
    return NextResponse.json({ error: "staging_submission_not_located" },
      { status: 404, headers: noStore });
  return NextResponse.json({ found: true, id: result.id }, { headers: noStore });
}
