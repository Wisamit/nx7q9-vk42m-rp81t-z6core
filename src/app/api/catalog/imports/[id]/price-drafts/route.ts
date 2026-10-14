import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CompositeWriteError, withScopedCompositeCreation } from "@/lib/catalog-composite-write";
import { clinicalImportTestWhere } from "@/lib/catalog-clinical-import-scope";
import { reconcilePriceCandidate, stagedPriceOverlapIndex } from "@/lib/price-import-reconciliation";

const fail = (error: string, status: number) => NextResponse.json({ error }, {
  status, headers: { "Cache-Control": "private, no-store" },
});
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function value(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function parseCandidate(data: unknown) {
  const row = record(data);
  return { priceListCode: value(row.priceListCode).toUpperCase(),
    testCode: value(row.testCode).toUpperCase(),
    unitPrice: value(row.unitPrice), effectiveFrom: value(row.effectiveFrom),
    effectiveTo: value(row.effectiveTo) };
}

/**
 * Importing legacy prices must not create a live tariff. This endpoint
 * materializes a reviewable, inactive price draft after current-scope
 * validation and exact effective-window checks. Activation and contract/client
 * mapping require a separate authorized financial decision.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("pricing.manage");
  if (!permissionSet(session).has("catalog.manage")) return fail("catalog_permission_required", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    return fail("json_required", 415);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("cross_site_denied", 403);
  const length = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(length) || length < 0 || length > 1024) return fail("request_too_large", 413);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "rowNumber" ||
      !Number.isSafeInteger(body.rowNumber) || body.rowNumber < 1 || body.rowNumber > 20000)
    return fail("invalid_import_row", 400);
  const { id } = await params;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!UUID.test(id)) return fail("batch_not_found", 404);
  const ctx = await requestContext();
  const org = session.user.organizationId;
  try {
    const result = await withScopedCompositeCreation(session, [], async (tx, scope) => {
      const user = await tx.user.findFirst({
        where: { id: session.user.id, organizationId: org, status: "ACTIVE" },
        select: { roles: { select: { role: { select: {
          organizationId: true, status: true,
          permissions: { select: { permission: { select: { code: true } } } },
        } } } } },
      });
      const canPrice = user?.roles.some(r => r.role.organizationId === org &&
        r.role.status === "ACTIVE" && r.role.permissions.some(p => p.permission.code === "pricing.manage"));
      if (!canPrice) throw new CompositeWriteError("pricing_permission_revoked");
      const batch = await tx.catalogImportBatch.findFirst({
        where: { id, organizationId: org, sourceType: "LEGACY_MDB_EXPORT" },
        select: { id: true, sourceType: true },
      });
      if (!batch) throw new CompositeWriteError("legacy_batch_not_found", 404);
      const row = await tx.catalogImportRow.findFirst({
        where: { batchId: batch.id, rowNumber: body.rowNumber,
          entityType: "PRICE_LIST_ITEM", status: { in: ["VALID", "WARNING"] },
          importedEntityId: null },
        select: { id: true, status: true, normalizedData: true },
      });
      if (!row) throw new CompositeWriteError("staged_price_unavailable", 409);
      const candidate = parseCandidate(row.normalizedData);
      // Reconcile the whole staged batch, not only one page. A later staged
      // overlapping tariff cannot be bypassed by choosing an earlier cursor.
      const all = await tx.catalogImportRow.findMany({
        where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM",
          status: { in: ["VALID", "WARNING"] } },
        select: { rowNumber: true, status: true, normalizedData: true },
        take: 20001,
      });
      if (all.length > 20000) throw new CompositeWriteError("price_batch_too_large", 409);
      if (stagedPriceOverlapIndex(all).has(body.rowNumber))
        throw new CompositeWriteError("overlapping_staged_prices", 409);
      const [list, test] = await Promise.all([
        tx.priceList.findFirst({ where: { organizationId: org,
          code: candidate.priceListCode, status: "ACTIVE",
          OR: [
            { scopeType: "ORGANIZATION", branchId: null,
              sourceId: null, clientId: null, contractId: null, referrerId: null },
            { scopeType: "BRANCH", branchId: scope.branchId,
              sourceId: null, clientId: null, contractId: null, referrerId: null },
          ],
        }, select: { id: true, code: true, status: true, currency: true,
          effectiveFrom: true, effectiveTo: true } }),
        tx.labTest.findFirst({ where: {
          ...clinicalImportTestWhere(scope), code: candidate.testCode,
        }, select: { id: true, code: true, status: true } }),
      ]);
      const existing = list && test ? await tx.priceListItem.findMany({ where: {
        priceListId: list.id, testId: test.id },
        select: { effectiveFrom: true, effectiveTo: true },
      }) : [];
      const check = reconcilePriceCandidate(candidate, {
        lists: new Map(list ? [[list.code.toUpperCase(), {
          id: list.id, status: list.status, currency: list.currency,
          effectiveFrom: list.effectiveFrom.toISOString(),
          effectiveTo: list.effectiveTo?.toISOString() || null,
        }]] : []),
        tests: new Map(test ? [[test.code.toUpperCase(), {
          id: test.id, status: test.status,
        }]] : []),
        existing: new Map(list && test ? [[list.id + "|" + test.id, existing.map(e => ({
          effectiveFrom: e.effectiveFrom.toISOString(),
          effectiveTo: e.effectiveTo?.toISOString() || null,
        }))]] : []),
      }, 1);
      if (check.disposition !== "READY_FOR_GOVERNANCE" || !check.resolvedPriceListId ||
          !check.resolvedTestId || !check.currency)
        throw new CompositeWriteError("legacy_price_requires_review:" + check.issues.join(","), 409);
      const claim = await tx.catalogImportRow.updateMany({
        where: { id: row.id, batchId: batch.id, status: row.status, importedEntityId: null },
        data: { status: "IMPORTED" },
      });
      if (claim.count !== 1) throw new CompositeWriteError("price_row_claim_conflict", 409);
      const price = await tx.priceListItem.create({ data: {
        priceListId: check.resolvedPriceListId, testId: check.resolvedTestId,
        unitPrice: new Prisma.Decimal(candidate.unitPrice),
        effectiveFrom: new Date(candidate.effectiveFrom),
        effectiveTo: candidate.effectiveTo ? new Date(candidate.effectiveTo) : null,
        status: "INACTIVE", deactivatedAt: new Date(),
      }, select: { id: true, status: true } });
      await tx.catalogImportRow.update({ where: { id: row.id },
        data: { status: "IMPORTED", importedEntityId: price.id } });
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: scope.branchId, actorUserId: session.user.id,
        action: "LEGACY_PRICE_DRAFT_IMPORTED", entityType: "PriceListItem", entityId: price.id,
        newValues: { batchId: batch.id, rowNumber: body.rowNumber, importRowId: row.id,
          priceListId: check.resolvedPriceListId, testId: check.resolvedTestId,
          currency: check.currency, unitPrice: candidate.unitPrice,
          effectiveFrom: candidate.effectiveFrom, effectiveTo: candidate.effectiveTo || null,
          financialApproved: false, activated: false, status: "INACTIVE" },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { id: price.id, currency: check.currency };
    });
    return NextResponse.json({ status: "INACTIVE_DRAFT", priceListItemId: result.id,
      currency: result.currency, activated: false, financialApproved: false,
      historicalInvoicesChanged: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof CompositeWriteError) return fail(e.code, e.status);
    throw e;
  }
}
