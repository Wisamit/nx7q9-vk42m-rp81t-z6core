import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  BRANCH_HOURS_KEY, authorizedBranchIds, canManageBranch, inputText,
  organizationBranchAdmin, validCode, validTimezone, validateWeeklyHours,
} from "@/lib/branch-administration";

function branchFields(body: Record<string, unknown>) {
  const code = body.code === undefined ? undefined : validCode(body.code);
  const nameEn = inputText(body.nameEn, 200, true);
  const nameAr = inputText(body.nameAr, 200);
  const timezone = body.timezone;
  const defaultCurrency = typeof body.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : "";
  const phone = inputText(body.phone, 50), email = inputText(body.email, 191);
  const addressEn = inputText(body.addressEn, 2000), addressAr = inputText(body.addressAr, 2000);
  if (!nameEn || nameAr === null || !validTimezone(timezone)
      || !/^[A-Z]{3}$/.test(defaultCurrency)
      || phone === null || email === null || addressEn === null || addressAr === null
      || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      || typeof body.isCentralLab !== "boolean" || (body.code !== undefined && !code)) return null;
  return {
    ...(code ? {code} : {}),
    nameEn, nameAr: nameAr || null, timezone,
    defaultCurrency, phone: phone || null, email: email || null,
    addressEn: addressEn || null, addressAr: addressAr || null,
    isCentralLab: body.isCentralLab,
  };
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return error("unauthorized", 401);
  const permissions = permissionSet(session);
  if (!permissions.has("branches.view") && !permissions.has("branches.manage")) return error("forbidden", 403);
  const org = session.user.organizationId;
  const all = organizationBranchAdmin(session);
  const authorized = authorizedBranchIds(session);
  const branches = await prisma.branch.findMany({
    where: { organizationId: org, ...(all ? {} : { id: { in: authorized } }) },
    select: {
      id: true, code: true, nameEn: true, nameAr: true, timezone: true, defaultCurrency: true,
      phone: true, email: true, addressEn: true, addressAr: true,
      status: true, isCentralLab: true, updatedAt: true,
      settings: { where: { key: BRANCH_HOURS_KEY }, select: { value: true } },
    },
    orderBy: [{ status: "asc" }, { code: "asc" }], take: 500,
  });
  return NextResponse.json({ branches: branches.map(({ settings, ...branch }) => ({
    ...branch, workingHours: settings[0]?.value || null,
  })), canCreate: all, canManage: permissions.has("branches.manage") }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return error("unauthorized", 401);
  if (!organizationBranchAdmin(session)) return error("organization_admin_required", 403);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("invalid_request", 400);
  const fields = branchFields(body as Record<string, unknown>);
  const validatedCode = fields?.code;
  if (!validatedCode) return error("invalid_branch_fields", 400);
  const ctx = await requestContext();
  const org = session.user.organizationId;
  try {
    const created = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${org} AND status = 'ACTIVE' FOR UPDATE`;
      const activeActor = await tx.user.findFirst({
        where: { id: session.userId, organizationId: org, status: "ACTIVE",
          roles: { some: { role: { code: "SYSTEM_ADMIN", isSystem: true, status: "ACTIVE" } } } },
      });
      if (!activeActor) throw Error("admin_revoked");
      const branch = await tx.branch.create({ data: { organizationId: org, ...fields, code: validatedCode } });
      await tx.userBranchScope.create({ data: { userId: session.userId, branchId: branch.id } });
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: branch.id, actorUserId: session.userId,
        action: "BRANCH_CREATED", entityType: "Branch", entityId: branch.id,
        newValues: { ...fields, firstAdministratorScopeGranted: session.userId },
        reason: "New branch created with scoped administrator access",
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return branch;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ status: "ok", branchId: created.id }, { status: 201 });
  } catch {
    return error("branch_creation_conflict_or_admin_revoked", 409);
  }
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session) return error("unauthorized", 401);
  if (!permissionSet(session).has("branches.manage")) return error("forbidden", 403);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("invalid_request", 400);
  const data = body as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return error("invalid_branch", 400);
  const org = session.user.organizationId, administrator = organizationBranchAdmin(session);
  if (!canManageBranch(session, id)) return error("branch_forbidden", 403);
  const operation = data.operation;
  if (!["update", "hours", "deactivate", "reactivate"].includes(String(operation))) return error("unknown_operation", 400);
  if (operation !== "hours" && !administrator) return error("organization_admin_required", 403);
  const fields = operation === "update" ? branchFields(data) : null;
  if (operation === "update" && (!fields || data.code !== undefined)) return error("invalid_branch_fields_or_immutable_code", 400);
  const hours = operation === "hours" ? validateWeeklyHours(data.workingHours) : null;
  if (operation === "hours" && !hours) return error("invalid_weekly_hours", 400);
  const reason = operation === "deactivate" ? inputText(data.reason, 1000, true) : "";
  if (operation === "deactivate" && (!reason || reason.length < 15)) return error("documented_closure_reason_required", 400);
  const ctx = await requestContext();
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${id} AND organization_id = ${org} FOR UPDATE`;
      const branch = await tx.branch.findFirst({ where: { id, organizationId: org } });
      if (!branch) throw Error("branch_not_found");
      const actor = await tx.user.findFirst({where:{id:session.userId,organizationId:org,status:"ACTIVE"}});
      if (!actor) throw Error("actor_revoked");
      const currentAdmin = await tx.userRole.findFirst({
        where: {userId: session.userId, role:{code:"SYSTEM_ADMIN",isSystem:true,status:"ACTIVE",organizationId:org}},
      });
      if (operation !== "hours" && !currentAdmin) throw Error("admin_revoked");
      if (operation === "hours") {
        const scope = await tx.userBranchScope.findUnique({ where: { userId_branchId:{userId:session.userId,branchId:id} } });
        if (!scope && !currentAdmin) throw Error("scope_revoked");
        if (branch.status !== "ACTIVE") throw Error("inactive_branch");
        const old = await tx.branchSetting.findUnique({ where: {branchId_key: { branchId:id, key:BRANCH_HOURS_KEY }} });
        await tx.branchSetting.upsert({
          where: {branchId_key: {branchId:id,key:BRANCH_HOURS_KEY}},
          update: {value: hours!}, create: {branchId:id,key:BRANCH_HOURS_KEY,value:hours!},
        });
        await tx.auditEvent.create({data:{
          organizationId:org,branchId:id,actorUserId:session.userId,action:"BRANCH_WORKING_HOURS_UPDATED",
          entityType:"BranchSetting",entityId:id,oldValues:old?.value || Prisma.JsonNull,
          newValues:hours!,reason:"Effective branch local working hours replaced",
          ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      } else if (operation === "update") {
        if (branch.status !== "ACTIVE") throw Error("inactive_branch");
        const changed = await tx.branch.update({where:{id},data:fields!});
        await tx.auditEvent.create({data:{
          organizationId:org,branchId:id,actorUserId:session.userId,action:"BRANCH_DETAILS_UPDATED",
          entityType:"Branch",entityId:id,
          oldValues:{nameEn:branch.nameEn,nameAr:branch.nameAr,timezone:branch.timezone,defaultCurrency:branch.defaultCurrency,
            isCentralLab:branch.isCentralLab,phone:branch.phone,email:branch.email,addressEn:branch.addressEn,addressAr:branch.addressAr},
          newValues:{nameEn:changed.nameEn,nameAr:changed.nameAr,timezone:changed.timezone,defaultCurrency:changed.defaultCurrency,
            isCentralLab:changed.isCentralLab,phone:changed.phone,email:changed.email,addressEn:changed.addressEn,addressAr:changed.addressAr},
          reason:"Governed branch master data update",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      } else if (operation === "deactivate") {
        if (branch.status !== "ACTIVE" || id === session.activeBranchId) throw Error("cannot_deactivate_active_workspace");
        // Fail closed: branch retirement is permitted only for unused operational locations.
        const blockers = await Promise.all([
          tx.labOrder.count({where:{orderingBranchId:id}}),
          tx.orderItem.count({where:{performedBranchId:id}}),
          tx.specimen.count({where:{OR:[{collectionBranchId:id},{currentBranchId:id}]}}),
          tx.invoice.count({where:{branchId:id}}),
          tx.equipment.count({where:{branchId:id}}),
          tx.analyzer.count({where:{branchId:id}}),
          tx.branchStock.count({where:{branchId:id}}),
          tx.inventoryLotStock.count({where:{branchId:id}}),
          tx.userBranchScope.count({where:{branchId:id}}),
          tx.department.count({where:{branchId:id,status:"ACTIVE"}}),
          tx.workstation.count({where:{branchId:id,status:"ACTIVE"}}),
          tx.appointment.count({where:{branchId:id}}),
          tx.specimenTransferManifest.count({where:{OR:[{sourceBranchId:id},{destinationBranchId:id}]}}),
        ]);
        if (blockers.some(n=>n>0)) throw Error("branch_has_operational_or_historical_references");
        const others = await tx.branch.count({where:{organizationId:org,status:"ACTIVE",id:{not:id}}});
        if (!others) throw Error("last_active_branch");
        await tx.branch.update({where:{id},data:{status:"INACTIVE",deactivatedAt:new Date()}});
        await tx.auditEvent.create({data:{
          organizationId:org,branchId:id,actorUserId:session.userId,action:"BRANCH_DEACTIVATED",
          entityType:"Branch",entityId:id,oldValues:{status:"ACTIVE"},newValues:{status:"INACTIVE"},
          reason:reason!,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      } else {
        if (branch.status !== "INACTIVE") throw Error("branch_not_inactive");
        await tx.branch.update({where:{id},data:{status:"ACTIVE",deactivatedAt:null}});
        await tx.auditEvent.create({data:{
          organizationId:org,branchId:id,actorUserId:session.userId,action:"BRANCH_REACTIVATED",
          entityType:"Branch",entityId:id,oldValues:{status:"INACTIVE"},newValues:{status:"ACTIVE"},
          reason:"Organization administrator reactivated branch",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      }
    }, {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({status:"ok"});
  } catch (e) {
    return error(e instanceof Error ? e.message : "branch_update_conflict", 409);
  }
}
