import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLegacyMasterRecords } from "@/lib/legacy-master-import-commit";
import { resolveLegacyCommentTargets } from "@/lib/legacy-comment-targets";
import {
  legacyMasterFingerprint, LegacyMasterImportError, parseLegacyMasterCsv,
  type LegacyMasterKind, type LegacyMasterRow,
} from "@/lib/legacy-master-data-import";

const allowed: Record<LegacyMasterKind, string> = {
  REFERRER: "referrers.manage",
  SOURCE: "sources.manage",
  ORGANISM: "microbiology.manage",
  ANTIBIOTIC: "microbiology.manage",
  CLIENT: "clients.manage",
  COMMENT_TEMPLATE: "result_comments.manage",
};

async function existingCodes(
  db: PrismaClient | Prisma.TransactionClient,
  kind: LegacyMasterKind,
  organizationId: string,
  codes: string[],
): Promise<string[]> {
  const where = { organizationId, code: { in: codes } };
  const records = kind === "COMMENT_TEMPLATE"
    ? await db.resultCommentTemplate.findMany({ where, select: { code: true } })
    : kind === "CLIENT"
    ? await db.client.findMany({ where, select: { code: true } })
    : kind === "REFERRER"
    ? await db.referrer.findMany({ where, select: { code: true } })
    : kind === "SOURCE"
      ? await db.orderSource.findMany({ where, select: { code: true } })
      : kind === "ORGANISM"
        ? await db.organism.findMany({ where, select: { code: true } })
        : await db.antibiotic.findMany({ where, select: { code: true } });
  return records.map(record => record.code);
}

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const permissions = permissionSet(session);
  if (!session.activeBranchId || !session.user.branchScopes.some(scope =>
    scope.branchId === session.activeBranchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === session.user.organizationId)) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length > 90_000) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const mode = input.mode === "PREVIEW" || input.mode === "APPLY" ? input.mode : null;
  const kind = typeof input.kind === "string" && Object.hasOwn(allowed, input.kind)
    ? input.kind as LegacyMasterKind : null;
  if (!mode || !kind || typeof input.csv !== "string") {
    return NextResponse.json({ error: "invalid_import_parameters" }, { status: 400 });
  }
  if (!permissions.has(allowed[kind])) {
    return NextResponse.json({ error: "master_data_permission_required" }, { status: 403 });
  }
  let rows: LegacyMasterRow[];
  try { rows = parseLegacyMasterCsv(kind, input.csv); }
  catch (error) {
    if (error instanceof LegacyMasterImportError) {
      return NextResponse.json({ error: error.reason }, { status: 400 });
    }
    throw error;
  }
  const organizationId = session.user.organizationId;
  const fingerprint = legacyMasterFingerprint(organizationId, kind, rows);
  const codes = rows.map(row => row.code);
  const collisions = await existingCodes(prisma, kind, organizationId, codes);
  const collisionsSet = new Set(collisions.map(code => code.toUpperCase()));
  if (kind === "COMMENT_TEMPLATE") {
    try { await resolveLegacyCommentTargets(prisma, organizationId, rows); }
    catch (error) {
      if (error instanceof LegacyMasterImportError)
        return NextResponse.json({ error: error.reason }, { status: 409 });
      throw error;
    }
  }

  if (mode === "PREVIEW") {
    return NextResponse.json({
      status: "review_only",
      kind,
      fingerprint,
      total: rows.length,
      eligible: rows.length - collisionsSet.size,
      conflicts: rows.filter(row => collisionsSet.has(row.code)).map(row => ({
        rowNumber: row.rowNumber, code: row.code, reason: "existing_code",
      })),
      rows: rows.map(row => ({
        ...row, status: collisionsSet.has(row.code) ? "CONFLICT" : "NEW",
      })),
      // Financial master previews explicitly expose terms; no hidden inferred contracts.
      financialScope: kind === "CLIENT" ? "CLIENT_MASTER_ONLY_NO_CONTRACTS_PRICES_OR_BALANCES" : null,
      clinicalScope: kind === "COMMENT_TEMPLATE" ? "INACTIVE_TEMPLATES_ONLY_NO_RESULT_REPORT_CHANGES" : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const confirmation = kind === "CLIENT" ? "CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS"
    : kind === "COMMENT_TEMPLATE" ? "CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY" : "CREATE_NEW_RECORDS_ONLY";
  if (input.confirmation !== confirmation || input.expectedFingerprint !== fingerprint) {
    return NextResponse.json({ error: "review_confirmation_or_fingerprint_required" }, { status: 409 });
  }
  if (collisionsSet.size > 0) {
    return NextResponse.json({ error: "existing_codes_prevent_import", conflicts: [...collisionsSet] },
      { status: 409 });
  }
  const sourceName = typeof input.sourceName === "string" ? input.sourceName.trim() : "";
  if (sourceName.length > 160 ||
    /[\u0000-\u001F\u007F]/.test(sourceName)) {
    return NextResponse.json({ error: "invalid_source_name" }, { status: 400 });
  }
  const context = await requestContext();
  const importId = randomUUID();
  const entries = rows.map(row => ({ ...row, id: randomUUID() }));
  try {
    await prisma.$transaction(async tx => {
      // Preview is not authority. Recheck live tenant codes inside the
      // serializable creation transaction before writing a single record.
      const changed = await existingCodes(tx, kind, organizationId, codes);
      if (changed.length > 0) throw new LegacyMasterImportError("existing_codes_changed_since_preview");
      await createLegacyMasterRecords(tx, kind, organizationId, entries);

      // One grouped import audit plus durable per-record identity.
      await tx.auditEvent.create({
        data: {
          organizationId, branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "LEGACY_MASTER_DATA_IMPORT_COMMITTED",
          entityType: "LegacyMasterImport", entityId: importId,
          newValues: { kind, sourceName, fingerprint, count: entries.length,
            entityIds: entries.map(row => row.id),
            ...(kind === "CLIENT" ? { financialScope: "MASTER_ONLY_NO_CONTRACTS_PRICES_OR_BALANCES" } : {}),
            ...(kind === "COMMENT_TEMPLATE" ? { clinicalScope: "INACTIVE_ONLY_NO_RESULT_CHANGES" } : {}),
          },
          ipAddress: context.ipAddress, userAgent: context.userAgent,
        },
      });
      for (const row of entries) {
        await tx.auditEvent.create({
          data: {
            organizationId, branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "LEGACY_MASTER_RECORD_CREATED",
            entityType: kind, entityId: row.id,
            newValues: {
              importId, code: row.code, nameEn: row.nameEn,
              nameAr: row.nameAr, fingerprint, sourceName,
              ...(kind === "COMMENT_TEMPLATE" ? {
                scope: row.commentScope, testCode: row.testCode,
                componentCode: row.componentCode, status: "INACTIVE",
                clinicalScope: "INACTIVE_ONLY_NO_RESULT_CHANGES",
              } : {}),
              ...(kind === "CLIENT" ? {
                clientType: row.clientType,
                paymentTermsDays: row.paymentTermsDays,
                financialScope: "MASTER_ONLY_NO_CONTRACTS_PRICES_OR_BALANCES",
              } : {}),
            },
            ipAddress: context.ipAddress, userAgent: context.userAgent,
          },
        });
      }
    }, { isolationLevel: "Serializable", timeout: 45_000 });

    return NextResponse.json({
      status: "imported", importId, kind,
      count: entries.length, fingerprint,
    }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const reason = error instanceof LegacyMasterImportError
      ? error.reason : "master_import_conflict_no_rows_committed";
    return NextResponse.json({ error: reason }, { status: 409 });
  }
}
