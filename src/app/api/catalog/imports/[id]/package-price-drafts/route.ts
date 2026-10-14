import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CompositeWriteError, withScopedCompositeCreation } from "@/lib/catalog-composite-write";
import { clinicalImportTestWhere } from "@/lib/catalog-clinical-import-scope";
import { calendarInstant, validPriceDecimal, overlaps } from "@/lib/price-import-reconciliation";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/i;
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
function candidate(value: unknown) {
  const r = asRecord(value);
  const txt = (key: string) => typeof r[key] === "string" ? (r[key] as string).trim() : "";
  return {
    priceListCode: txt("priceListCode").toUpperCase(),
    packageCode: txt("packageCode").toUpperCase(),
    unitPrice: txt("unitPrice"), effectiveFrom: txt("effectiveFrom"),
    effectiveTo: txt("effectiveTo"),
  };
}
/**
 * This is ONLY a draft admission for legacy commercial package tariffs.
 * It cannot approve financial authority, alter an active price or reprice an
 * already issued invoice. Target packages must have entirely scoped members.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("pricing.manage");
  if (!permissionSet(session).has("catalog.manage")) return fail("catalog_permission_required", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return fail("json_required", 415);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("cross_site_denied", 403);
  const indicated = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(indicated) || indicated < 0 || indicated > 1024)
    return fail("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return fail("missing_request", 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 1024) { await reader.cancel("too_large"); return fail("request_too_large", 413); }
    chunks.push(part.value);
  }
  let body: Record<string, unknown>;
  try {
    body = asRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return fail("invalid_json", 400); }
  if (Object.keys(body).sort().join(",") !== "rowNumber" ||
      !Number.isSafeInteger(body.rowNumber) || (body.rowNumber as number) < 1 ||
      (body.rowNumber as number) > 20000)
    return fail("invalid_import_row", 400);
  const rowNumber = body.rowNumber as number;\n  const { id } = await params;
  if (!UUID.test(id)) return fail("batch_not_found", 404);
  const org = session.user.organizationId, ctx = await requestContext();
  try {
    const result = await withScopedCompositeCreation(session, [], async (tx, scope) => {
      const live = await tx.user.findFirst({
        where: { id: session.user.id, organizationId: org, status: "ACTIVE" },
        select: { roles: { select: { role: { select: {
          organizationId: true, status: true,
          permissions: { select: { permission: { select: { code: true } } } },
        } } } } },
      });
      if (!live?.roles.some(r => r.role.organizationId === org && r.role.status === "ACTIVE" &&
        r.role.permissions.some(p => p.permission.code === "pricing.manage")))
        throw new CompositeWriteError("pricing_permission_revoked", 403);
      const row = await tx.catalogImportRow.findFirst({
        where: { batchId: id, rowNumber,
          entityType: "PRICE_LIST_PACKAGE_ITEM", status: { in: ["WARNING", "VALID"] },
          importedEntityId: null, batch: { organizationId: org, sourceType: "LEGACY_MDB_EXPORT" } },
        select: { id: true, status: true, normalizedData: true },
      });
      if (!row) throw new CompositeWriteError("staged_package_tariff_unavailable", 409);
      const c = candidate(row.normalizedData);
      const start = calendarInstant(c.effectiveFrom);
      const end = c.effectiveTo ? calendarInstant(c.effectiveTo) : null;
      if (!c.packageCode || !c.priceListCode || !validPriceDecimal(c.unitPrice) ||
          start === null || c.effectiveTo && end === null || end !== null && start !== null && end < start)
        throw new CompositeWriteError("package_tariff_invalid_exact_values", 409);
      // A package containing even one unauthorized/off-branch/disabled assay
      // is never eligible, regardless of the operator's ability to guess its ID.
      const permittedMembers = { some: {}, every: {
        test: clinicalImportTestWhere(scope),
      } };
      const [list, pack, staged] = await Promise.all([
        tx.priceList.findFirst({ where: { organizationId: org,
          code: c.priceListCode, status: "ACTIVE",
          sourceId: null, referrerId: null, clientId: null, contractId: null,
          OR: [
            { scopeType: "ORGANIZATION", branchId: null },
            { scopeType: "BRANCH", branchId: scope.branchId },
          ] }, select: {
            id: true, code: true, currency: true, effectiveFrom: true, effectiveTo: true,
          } }),
        tx.commercialPackage.findFirst({ where: { organizationId: org,
          code: c.packageCode, status: "ACTIVE", items: permittedMembers },
          select: { id: true, code: true } }),
        tx.catalogImportRow.findMany({
          where: { batchId: id, entityType: "PRICE_LIST_PACKAGE_ITEM",
            status: { in: ["WARNING", "VALID"] } },
          select: { rowNumber: true, normalizedData: true }, take: 20001,
        }),
      ]);
      if (staged.length > 20000) throw new CompositeWriteError("package_tariff_batch_too_large", 409);
      if (!list || !pack || !/^[A-Z]{3}$/.test(list.currency))
        throw new CompositeWriteError("public_list_or_package_not_authorized", 403);
      const listFrom = calendarInstant(list.effectiveFrom.toISOString());
      const listTo = list.effectiveTo ? calendarInstant(list.effectiveTo.toISOString()) : null;
      if (listFrom === null || start! < listFrom ||
          (listTo !== null && (end === null || end > listTo)))
        throw new CompositeWriteError("package_tariff_outside_price_list_window", 409);
      if (staged.some(entry => entry.rowNumber !== rowNumber &&
          candidate(entry.normalizedData).priceListCode === c.priceListCode &&
          candidate(entry.normalizedData).packageCode === c.packageCode &&
          overlaps(c.effectiveFrom, c.effectiveTo || null,
            candidate(entry.normalizedData).effectiveFrom,
            candidate(entry.normalizedData).effectiveTo || null)))
        throw new CompositeWriteError("staged_package_tariff_overlap", 409);
      const existing = await tx.priceListPackageItem.findMany({
        where: { priceListId: list.id, packageId: pack.id },
        select: { effectiveFrom: true, effectiveTo: true },
      });
      if (existing.some(other => overlaps(c.effectiveFrom, c.effectiveTo || null,
          other.effectiveFrom.toISOString(), other.effectiveTo?.toISOString() || null)))
        throw new CompositeWriteError("existing_package_tariff_window_overlap", 409);
      const claimed = await tx.catalogImportRow.updateMany({
        where: { id: row.id, batchId: id, status: row.status, importedEntityId: null },
        data: { status: "IMPORTED" },
      });
      if (claimed.count !== 1) throw new CompositeWriteError("package_tariff_claim_race", 409);
      const draft = await tx.priceListPackageItem.create({
        data: { priceListId: list.id, packageId: pack.id,
          unitPrice: new Prisma.Decimal(c.unitPrice),
          effectiveFrom: new Date(c.effectiveFrom),
          effectiveTo: c.effectiveTo ? new Date(c.effectiveTo) : null,
          status: "INACTIVE", deactivatedAt: new Date() },
        select: { id: true },
      });
      await tx.catalogImportRow.update({ where: { id: row.id },
        data: { status: "IMPORTED", importedEntityId: draft.id } });
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: scope.branchId, actorUserId: session.user.id,
        action: "LEGACY_PACKAGE_TARIFF_DRAFT_IMPORTED",
        entityType: "PriceListPackageItem", entityId: draft.id,
        newValues: { batchId: id, importRowId: row.id, rowNumber,
          packageId: pack.id, priceListId: list.id, currency: list.currency,
          price: c.unitPrice, effectiveFrom: c.effectiveFrom,
          effectiveTo: c.effectiveTo || null, status: "INACTIVE",
          financialApproved: false, activated: false, historicalInvoicesChanged: false },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { id: draft.id, currency: list.currency };
    });
    return NextResponse.json({ status: "INACTIVE_DRAFT", packagePriceId: result.id,
      currency: result.currency, financialApproved: false, activated: false,
      historicalInvoicesChanged: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CompositeWriteError) return fail(error.code, error.status);
    throw error;
  }
}
