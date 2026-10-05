import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("microbiology.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const type = body.type === "ORGANISM" || body.type === "ANTIBIOTIC" ? body.type : null;
  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr) || null;
  if (!type || !code || !nameEn || !/^[A-Z0-9._-]{1,80}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  try {
    const item = await prisma.$transaction(async tx => {
      const created = type === "ORGANISM"
        ? await tx.organism.create({
            data: {
              organizationId: session.user.organizationId,
              code,
              nameEn,
              nameAr,
              category: text(body.category, 120) || null,
            },
          })
        : await tx.antibiotic.create({
            data: {
              organizationId: session.user.organizationId,
              code,
              nameEn,
              nameAr,
              drugClass: text(body.drugClass, 150) || null,
            },
          });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: type === "ORGANISM" ? "MICROBIOLOGY_ORGANISM_CREATED" : "MICROBIOLOGY_ANTIBIOTIC_CREATED",
          entityType: type === "ORGANISM" ? "Organism" : "Antibiotic",
          entityId: created.id,
          newValues: { code, nameEn, nameAr },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", item }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}
