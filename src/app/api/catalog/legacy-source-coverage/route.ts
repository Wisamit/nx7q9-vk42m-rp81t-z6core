import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  compareLegacyCoverage, LegacyCoverageError, LEGACY_COVERAGE_MAX_BYTES,
  parseLegacySourceCoverage, sourceCoverageFingerprint,
} from "@/lib/legacy-source-coverage";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers });

/**
 * Deidentified operator evidence, NOT an Access MDB upload. The original
 * patient and clinical-value records never cross this API boundary.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return fail("unauthorized", 401);
  const grants = permissionSet(session);
  if (!["catalog.manage", "pricing.manage", "catalog.reference_ranges.manage"]
    .every(code => grants.has(code))) return fail("source_coverage_permissions_required", 403);
  const orgId = session.user.organizationId;
  const activeBranchId = session.activeBranchId;
  if (!activeBranchId || !session.user.branchScopes.some(b =>
    b.branchId === activeBranchId && b.branch.organizationId === orgId &&
    b.branch.status === "ACTIVE")) return fail("active_branch_scope_required", 403);
  // Organization-wide counts cannot be safely advertised from a restricted
  // department session, even if the caller happens to know an MDB path.
  if (session.user.departmentScopes.length) return fail("organization_catalog_scope_required", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return fail("json_required", 415);
  const length = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(length) || length < 0 || length > LEGACY_COVERAGE_MAX_BYTES)
    return fail("source_coverage_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return fail("missing_source_manifest", 400);
  const bytes: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > LEGACY_COVERAGE_MAX_BYTES) {
      await reader.cancel("source_coverage_too_large");
      return fail("source_coverage_too_large", 413);
    }
    bytes.push(part.value);
  }
  let manifest: ReturnType<typeof parseLegacySourceCoverage>;
  try {
    manifest = parseLegacySourceCoverage(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(bytes))));
  } catch (error) {
    if (error instanceof LegacyCoverageError) return fail(error.code, 400);
    return fail("invalid_source_manifest_json", 400);
  }
  const fingerprint = sourceCoverageFingerprint(manifest);
  const ctx = await requestContext();
  const result = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM organizations WHERE id=${orgId} AND status='ACTIVE' FOR UPDATE`;
    if (locked.length !== 1) return { error:"organization_inactive", status:403 } as const;
    const liveUser = await tx.user.findFirst({
      where: { id:session.user.id, organizationId:orgId, status:"ACTIVE" },
      select: { id:true, roles: { select: {role: {
        select: {organizationId:true,status:true,permissions:{
          select: {permission:{select:{code:true}}} },
        },
      } } } },
    });
    const currentGrants = new Set(liveUser?.roles.filter(r =>
      r.role.organizationId === orgId && r.role.status === "ACTIVE"
    ).flatMap(r => r.role.permissions.map(p => p.permission.code)) || []);
    if (!["catalog.manage", "pricing.manage", "catalog.reference_ranges.manage"]
      .every(code => currentGrants.has(code)))
      return { error:"source_coverage_permissions_revoked", status:403 } as const;
    const [branch, userBranch, departmentScopeCount] = await Promise.all([
      tx.branch.findFirst({where:{id:activeBranchId,organizationId:orgId,status:"ACTIVE"},
        select:{id:true}}),
      tx.userBranchScope.findUnique({where:{userId_branchId:{
        userId:session.user.id,branchId:activeBranchId,
      }},select:{userId:true}}),
      tx.userDepartmentScope.count({where:{userId:session.user.id}}),
    ]);
    if (!branch || !userBranch || departmentScopeCount !== 0)
      return {error:"source_coverage_scope_revoked",status:403} as const;

    // A name match only discovers POSSIBLE source batches: no signed link from
    // the MDB SHA to the JSON staging checksum exists in the legacy pipeline.
    const batches = await tx.catalogImportBatch.findMany({
      where: { organizationId:orgId, createdByUserId:session.user.id,
        sourceType:"LEGACY_MDB_EXPORT", sourceName:manifest.sourceName },
      select: {id:true,sourceChecksum:true}, take:101,
      orderBy:[{createdAt:"desc"},{id:"desc"}],
    });
    if (batches.length > 100)
      return {error:"too_many_possible_source_batches",status:409} as const;
    const ids = batches.map(b=>b.id);
    const groups = ids.length ? await tx.catalogImportRow.groupBy({
      by:["entityType","status"],
      where:{batchId:{in:ids},batch:{organizationId:orgId}},
      _count:{_all:true},
    }) : [];
    const coverage = compareLegacyCoverage(manifest,groups.map(g=>({
      entityType:g.entityType,status:g.status,count:g._count._all,
    })),batches.length);
    const findings = [...new Set(coverage.map(c=>c.finding))];
    const potentialStaging = batches.length;
    await tx.auditEvent.create({data:{
      organizationId:orgId,branchId:activeBranchId,
      actorUserId:session.user.id,action:"LEGACY_SOURCE_COVERAGE_REVIEWED",
      entityType:"LegacySourceCoverage",entityId:randomUUID(),
      newValues:{sourceSha256:manifest.sourceSha256,
        manifestFingerprint:fingerprint,sourceTableCount:coverage.length,
        presentTables:coverage.filter(c=>c.present).length,
        potentialStaging,findings,
        reviewedOnly:true,sourceFileIndependentlyVerified:false,
        rowLevelProvenanceVerified:false,liveWrites:false},
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return {
      status:"REVIEW_ONLY" as const,
      sourceSha256:manifest.sourceSha256,manifestFingerprint:fingerprint,
      sourceName:manifest.sourceName,
      possibleBatches:potentialStaging,
      batchChecksumNote:"Staging JSON checksums do not authenticate the original MDB bytes.",
      sourceIndependentlyVerified:false, rowParityCertified:false,
      clinicalApproved:false,financialApproved:false,cutoverApproved:false,
      coverage,findings,
    };
  }, { isolationLevel:"Serializable",timeout:30_000 });
  if ("error" in result) return fail(result.error,result.status);
  return NextResponse.json(result,{headers});
}
