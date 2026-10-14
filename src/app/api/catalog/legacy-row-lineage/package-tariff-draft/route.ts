import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { CompositeWriteError, withScopedCompositeCreation } from "@/lib/catalog-composite-write";
import { clinicalImportTestWhere } from "@/lib/catalog-clinical-import-scope";
import { calendarInstant, overlaps, validPriceDecimal } from "@/lib/price-import-reconciliation";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(error: string, status: number) {
  return NextResponse.json({ error }, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
}
type DraftInput = {
  lineageId: string; expectedRevision: number;
  packageId: string; priceListId: string; unitPrice: string;
  effectiveFrom: string; effectiveTo: string | null; reason: string;
};
function parseInput(raw: unknown): DraftInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CompositeWriteError("invalid_package_tariff_draft", 400);
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).sort().join(",") !==
      "effectiveFrom,effectiveTo,expectedRevision,lineageId,packageId,priceListId,reason,unitPrice" ||
      typeof obj.lineageId !== "string" || !UUID.test(obj.lineageId) ||
      typeof obj.packageId !== "string" || !UUID.test(obj.packageId) ||
      typeof obj.priceListId !== "string" || !UUID.test(obj.priceListId) ||
      typeof obj.reason !== "string" || obj.reason.trim().length < 12 || obj.reason.length > 1000 ||
      !Number.isSafeInteger(obj.expectedRevision) ||
      (obj.expectedRevision as number) < 0 || (obj.expectedRevision as number) > 100000 ||
      typeof obj.unitPrice !== "string" || !validPriceDecimal(obj.unitPrice) ||
      typeof obj.effectiveFrom !== "string" || calendarInstant(obj.effectiveFrom) === null ||
      obj.effectiveTo !== null && (typeof obj.effectiveTo !== "string" ||
        calendarInstant(obj.effectiveTo) === null) ||
      (obj.effectiveTo !== null &&
        calendarInstant(obj.effectiveTo as string)! < calendarInstant(obj.effectiveFrom)!)) {
    throw new CompositeWriteError("invalid_package_tariff_draft", 400);
  }
  return { ...obj, reason: obj.reason.trim() } as DraftInput;
}

/** A source identity may authorize an INACTIVE candidate, never live billing. */
export async function POST(request: Request) {
  const session = await requirePermission("pricing.manage");
  if (!permissionSet(session).has("catalog.manage"))
    return fail("catalog_permission_required", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return fail("json_required", 415);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("cross_site_denied", 403);
  const stated = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(stated) || stated < 0 || stated > 2048)
    return fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return fail("missing_json_body", 400);
  let total = 0; const parts: Uint8Array[] = [];
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > 2048) {
      await reader.cancel("request_too_large");
      return fail("request_too_large", 413);
    }
    parts.push(part.value);
  }
  let proposed: DraftInput;
  try {
    proposed = parseInput(JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(parts))));
  } catch (error) {
    if (error instanceof CompositeWriteError) return fail(error.code, error.status);
    return fail("invalid_json", 400);
  }
  const org = session.user.organizationId;
  const ctx = await requestContext();
  try {
    const result = await withScopedCompositeCreation(session, [], async (tx, scope) => {
      const user = await tx.user.findFirst({
        where: { id: session.user.id, organizationId: org, status: "ACTIVE" },
        select: { roles: { select: { role: { select: {
          organizationId: true, status: true,
          permissions: { select: { permission: { select: { code: true } } } },
        } } } } },
      });
      const priceRole = user?.roles.some(item => item.role.organizationId === org &&
        item.role.status === "ACTIVE" && item.role.permissions.some(p =>
          p.permission.code === "pricing.manage"));
      if (!priceRole) throw new CompositeWriteError("pricing_permission_revoked");
      const lineage = await tx.legacyCatalogRowLineage.findFirst({ where: {
        id: proposed.lineageId, organizationId: org, sourceTable: "price",
        classification: "UNRESOLVED", revision: proposed.expectedRevision,
        targetId: null, targetType: null, createdByUserId: session.user.id,
      }, select: { id: true, revision: true, sourceSha256: true, digestKeyId: true,
        rowDigest: true, occurrence: true } });
      if (!lineage) throw new CompositeWriteError("source_row_not_authorized_or_claimed", 409);
      const [pkg, list] = await Promise.all([
        tx.commercialPackage.findFirst({ where: {
          id: proposed.packageId, organizationId: org, status: "ACTIVE",
          items: { some: {}, every: { test: clinicalImportTestWhere(scope) } },
        }, select: { id: true, code: true } }),
        tx.priceList.findFirst({ where: {
          id: proposed.priceListId, organizationId: org, status: "ACTIVE",
          OR: [
            { scopeType: "ORGANIZATION", branchId: null,
              sourceId: null, referrerId: null, clientId: null, contractId: null },
            { scopeType: "BRANCH", branchId: scope.branchId,
              sourceId: null, referrerId: null, clientId: null, contractId: null },
          ],
        }, select: {
          id: true, currency: true, scopeType: true, branchId: true,
          effectiveFrom: true, effectiveTo: true,
        } }),
      ]);
      if (!pkg || !list) throw new CompositeWriteError("package_or_price_scope_denied", 403);
      const start = calendarInstant(proposed.effectiveFrom)!;
      const end = proposed.effectiveTo === null ? null : calendarInstant(proposed.effectiveTo)!;
      if (start < list.effectiveFrom.getTime() ||
          list.effectiveTo && (end === null || end > list.effectiveTo.getTime()))
        throw new CompositeWriteError("outside_price_list_effective_window", 409);
      const current = await tx.priceListPackageItem.findMany({ where: {
        priceListId: list.id, packageId: pkg.id },
        select: { effectiveFrom: true, effectiveTo: true },
      });
      if (current.some(t => overlaps(
        proposed.effectiveFrom, proposed.effectiveTo,
        t.effectiveFrom.toISOString(), t.effectiveTo?.toISOString() || null,
      ))) throw new CompositeWriteError("package_price_window_collision", 409);
      const price = await tx.priceListPackageItem.create({
        data: { priceListId: list.id, packageId: pkg.id,
          unitPrice: new Prisma.Decimal(proposed.unitPrice),
          effectiveFrom: new Date(proposed.effectiveFrom),
          effectiveTo: proposed.effectiveTo ? new Date(proposed.effectiveTo) : null,
          status: "INACTIVE", deactivatedAt: new Date(),
        },
        select: { id: true, status: true },
      });
      const claim = await tx.legacyCatalogRowLineage.updateMany({ where: {
        id: lineage.id, organizationId: org,
        revision: proposed.expectedRevision, classification: "UNRESOLVED",
        targetId: null, targetType: null,
      }, data: {
        revision: { increment: 1 }, classification: "MAPPED",
        targetType: "PRICE_LIST_PACKAGE_ITEM", targetId: price.id,
        mappedByUserId: session.user.id, reason: proposed.reason,
      } });
      if (claim.count !== 1) throw new CompositeWriteError("legacy_lineage_claim_conflict", 409);
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: scope.branchId, actorUserId: session.user.id,
        action: "LEGACY_PACKAGE_TARIFF_INACTIVE_DRAFT_CREATED",
        entityType: "PriceListPackageItem", entityId: price.id,
        newValues: { sourceLineageId: lineage.id,
          sourceSha256: lineage.sourceSha256, digestKeyId: lineage.digestKeyId,
          rowDigest: lineage.rowDigest, occurrence: lineage.occurrence,
          packageId: pkg.id, priceListId: list.id, currency: list.currency,
          unitPrice: proposed.unitPrice, effectiveFrom: proposed.effectiveFrom,
          effectiveTo: proposed.effectiveTo, mappedRevision: proposed.expectedRevision + 1,
          independentMappingReviewRequired: true,
          financialApproved: false, activated: false },
        reason: proposed.reason, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { id: price.id, lineageRevision: proposed.expectedRevision + 1,
        currency: list.currency };
    });
    return NextResponse.json({ status: "INACTIVE_DRAFT",
      priceListPackageItemId: result.id, currency: result.currency,
      lineageRevision: result.lineageRevision,
      independentMappingReviewRequired: true, financialApproved: false,
      activated: false, historicalInvoicesChanged: false },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CompositeWriteError) return fail(error.code, error.status);
    throw error;
  }
}
