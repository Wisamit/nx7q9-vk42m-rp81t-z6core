import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "../../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  legacyMasterFingerprint, LegacyMasterImportError, parseLegacyMasterCsv,
  type LegacyMasterKind, type LegacyMasterRow,
} from "@/lib/legacy-master-data-import";

const allowed: Record<LegacyMasterKind, string> = {
  REFERRER: "referrers.manage",
  SOURCE: "sources.manage",
  ORGANISM: "microbiology.manage",
  ANTIBIOTIC: "microbiology.manage",
};

async function existingCodes(
  db: PrismaClient | Prisma.TransactionClient,
  kind: LegacyMasterKind,
  organizationId: string,
  codes: string[],
): Promise<string[]> {
  const where = { organizationId, code: { in: codes } };
  const records = kind === "REFERRER"
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
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (input.confirmation !== "CREATE_NEW_RECORDS_ONLY" || input.expectedFingerprint !== fingerprint) {
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
      if (kind === "REFERRER") {
        await tx.referrer.createMany({ data: entries.map(row => ({
          id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
          nameAr: row.nameAr, type: row.type!, phone: row.phone,
          email: row.email, licenseNumber: row.licenseNumber,
        })) });
      } else if (kind === "SOURCE") {
        await tx.orderSource.createMany({ data: entries.map(row => ({
          id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
          nameAr: row.nameAr, category: row.category!,
        })) });
      } else if (kind === "ORGANISM") {
        await tx.organism.createMany({ data: entries.map(row => ({
          id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
          nameAr: row.nameAr, category: row.category,
        })) });
      } else {
        await tx.antibiotic.createMany({ data: entries.map(row => ({
          id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
          nameAr: row.nameAr, drugClass: row.drugClass,
        })) });
      }

      // One grouped import audit plus durable per-record identity.
      await tx.auditEvent.create({
        data: {
          organizationId, branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "LEGACY_MASTER_DATA_IMPORT_COMMITTED",
          entityType: "LegacyMasterImport", entityId: importId,
          newValues: { kind, sourceName, fingerprint, count: entries.length,
            entityIds: entries.map(row => row.id) },
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
