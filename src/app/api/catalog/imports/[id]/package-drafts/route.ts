import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { CompositeWriteError, withScopedCompositeCreation } from "@/lib/catalog-composite-write";
import { clinicalImportTestWhere } from "@/lib/catalog-clinical-import-scope";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string, status: number) =>
  NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store" } });
function record(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
}
/** Only creates inactive new packages from complete explicit legacy membership. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return fail("json_required", 415);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("cross_site_denied", 403);
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > 1024)
    return fail("payload_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return fail("missing_request_body", 400);
  const parts: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 1024) { await reader.cancel("payload_too_large"); return fail("payload_too_large", 413); }
    parts.push(part.value);
  }
  let obj: Record<string, unknown>;
  try {
    obj = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))));
  } catch { return fail("invalid_json", 400); }
  if (Object.keys(obj).join(",") !== "rowNumber" || !Number.isSafeInteger(obj.rowNumber) ||
      (obj.rowNumber as number) < 1 || (obj.rowNumber as number) > 20000)
    return fail("invalid_row_number", 400);
  const { id } = await params;
  if (!UUID.test(id)) return fail("batch_not_found", 404);
  const org = session.user.organizationId, ctx = await requestContext();
  try {
    const created = await withScopedCompositeCreation(session, [], async (tx, scope) => {
      const row = await tx.catalogImportRow.findFirst({ where: {
        batchId: id, rowNumber: obj.rowNumber as number, entityType: "PACKAGE",
        status: { in: ["VALID", "WARNING"] }, importedEntityId: null,
        batch: { organizationId: org, sourceType: "LEGACY_MDB_EXPORT",
          createdByUserId: session.user.id, status: { in: ["VALIDATED", "IMPORTED"] } },
      }, select: { id: true, status: true, normalizedData: true } });
      if (!row) throw new CompositeWriteError("legacy_package_row_unavailable", 409);
      const normalized = record(row.normalizedData);
      const code = normalized.code, nameEn = normalized.nameEn, nameAr = normalized.nameAr;
      const members = normalized.memberTestCodes;
      if (typeof code !== "string" || !/^[A-Z0-9._-]{1,80}$/.test(code) ||
          typeof nameEn !== "string" || nameEn.length > 220 || !nameEn.trim() ||
          nameAr !== undefined && (typeof nameAr !== "string" || nameAr.length > 220) ||
          !Array.isArray(members) || members.length < 1 || members.length > 300 ||
          members.some(k => typeof k !== "string" || !/^[A-Z0-9._-]{1,80}$/.test(k)) ||
          new Set(members).size !== members.length)
        throw new CompositeWriteError("incomplete_or_ambiguous_package_membership", 409);
      const existing = await tx.commercialPackage.findUnique({ where: {
        organizationId_code: { organizationId: org, code } },
        select: { id: true },
      } });
      if (existing) throw new CompositeWriteError("existing_package_requires_separate_review", 409);
      const tests = await tx.labTest.findMany({
        where: { ...clinicalImportTestWhere(scope), code: { in: members as string[] } },
        select: { id: true, code: true },
      });
      if (tests.length !== members.length)
        throw new CompositeWriteError("package_membership_not_wholly_authorized", 403);
      const byCode = new Map(tests.map(t => [t.code, t.id]));
      const claim = await tx.catalogImportRow.updateMany({ where: {
        id: row.id, batchId: id, status: row.status, importedEntityId: null,
      }, data: { status: "IMPORTED" } });
      if (claim.count !== 1) throw new CompositeWriteError("package_draft_claim_conflict", 409);
      const pkg = await tx.commercialPackage.create({ data: {
        organizationId: org, code, nameEn,
        nameAr: typeof nameAr === "string" ? nameAr || null : null,
        status: "INACTIVE", deactivatedAt: new Date(),
      }, select: { id: true } });
      const linked = (members as string[]).map((memberCode, index) => ({
        packageId: pkg.id, testId: byCode.get(memberCode)!, displayOrder: index,
      }));
      await tx.commercialPackageItem.createMany({ data: linked });
      await tx.catalogImportRow.update({ where: { id: row.id },
        data: { importedEntityId: pkg.id, status: "IMPORTED" } });
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: scope.branchId, actorUserId: session.user.id,
        action: "LEGACY_PACKAGE_DRAFT_IMPORTED",
        entityType: "CommercialPackage", entityId: pkg.id,
        newValues: { batchId: id, importRowId: row.id, rowNumber: obj.rowNumber,
          code, members, inactive: true, clinicalApproved: false,
          financialApproved: false, activated: false },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { id: pkg.id, memberCount: linked.length };
    });
    return NextResponse.json({ status: "INACTIVE_DRAFT", packageId: created.id,
      memberCount: created.memberCount, clinicalApproved: false,
      financialApproved: false, activated: false },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CompositeWriteError) return fail(error.code, error.status);
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return fail("package_code_exists", 409);
    throw error;
  }
}
