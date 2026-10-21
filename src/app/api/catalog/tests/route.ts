import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  projectF2EffectiveCatalogView,resolveF2EffectiveCatalogViews,
} from "@/lib/catalog-f2-effective-view";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const organizationId=session.user.organizationId;
  const result=await prisma.$transaction(async tx=>{
    const asOf=new Date();
    const [tests,departments,specimenTypes,containers,methods,units]=await Promise.all([
      tx.labTest.findMany({
        where:{organizationId},
        include:{department:true,specimenType:true,defaultUnit:true,
          components:{orderBy:{displayOrder:"asc"}}},
        orderBy:[{status:"asc"},{nameEn:"asc"}],
      }),
      tx.department.findMany({where:{organizationId,status:"ACTIVE"},orderBy:{nameEn:"asc"}}),
      tx.specimenType.findMany({where:{organizationId,status:"ACTIVE"},orderBy:{nameEn:"asc"}}),
      tx.container.findMany({where:{organizationId},orderBy:{nameEn:"asc"}}),
      tx.method.findMany({where:{organizationId,status:"ACTIVE"},orderBy:{nameEn:"asc"}}),
      tx.unit.findMany({where:{organizationId},orderBy:{code:"asc"}}),
    ]);
    const targets=[
      ...tests.map(row=>({entityType:"TEST" as const,id:row.id})),
      ...tests.flatMap(row=>row.components.map(component=>({
        entityType:"COMPONENT" as const,id:component.id,
      }))),
      ...units.map(row=>({entityType:"UNIT" as const,id:row.id})),
      ...containers.map(row=>({entityType:"CONTAINER" as const,id:row.id})),
    ];
    const overlays=await resolveF2EffectiveCatalogViews(tx,{
      organizationId,asOf,records:targets,
    });
    const effectiveTests=tests.map(row=>({
      ...projectF2EffectiveCatalogView("TEST",row,overlays),
      defaultUnit:row.defaultUnit?
        projectF2EffectiveCatalogView("UNIT",row.defaultUnit,overlays):null,
      components:row.components.map(component=>
        projectF2EffectiveCatalogView("COMPONENT",component,overlays))
        .sort((a,b)=>a.displayOrder-b.displayOrder||a.code.localeCompare(b.code)),
    })).sort((a,b)=>a.status.localeCompare(b.status)||
      a.nameEn.localeCompare(b.nameEn));
    const effectiveContainers=containers
      .map(row=>projectF2EffectiveCatalogView("CONTAINER",row,overlays))
      .filter(row=>row.status==="ACTIVE")
      .sort((a,b)=>a.nameEn.localeCompare(b.nameEn));
    const effectiveUnits=units
      .map(row=>projectF2EffectiveCatalogView("UNIT",row,overlays))
      .filter(row=>row.status==="ACTIVE")
      .sort((a,b)=>a.code.localeCompare(b.code));
    return {tests:effectiveTests,departments,specimenTypes,
      containers:effectiveContainers,methods,units:effectiveUnits};
  },{isolationLevel:"RepeatableRead",timeout:30000});
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim() : "";
  if (!code || !nameEn || !/^[A-Z0-9._-]{1,80}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const tatMinutes = body.tatMinutes == null || body.tatMinutes === "" ? null : Number(body.tatMinutes);
  if (tatMinutes !== null && (!Number.isInteger(tatMinutes) || tatMinutes < 0 || tatMinutes > 5_256_000)) {
    return NextResponse.json({ error: "invalid_tat_minutes" }, { status: 400 });
  }

  try {
    const test = await prisma.$transaction(async (tx) => {
      const created = await tx.labTest.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr: nameAr || null,
          abbreviation: typeof body.abbreviation === "string" ? body.abbreviation.trim().slice(0, 80) || null : null,
          resultType: body.resultType === "TEXT" || body.resultType === "QUALITATIVE" || body.resultType === "BOOLEAN" || body.resultType === "DATE" ? body.resultType : "NUMERIC",
          workflowType: body.workflowType === "MICROBIOLOGY" ? "MICROBIOLOGY" : "GENERAL",
          departmentId: body.departmentId || null,
          specimenTypeId: body.specimenTypeId || null,
          containerId: body.containerId || null,
          methodId: body.methodId || null,
          defaultUnitId: body.defaultUnitId || null,
          decimalPrecision: Number.isInteger(body.decimalPrecision) ? body.decimalPrecision : null,
          tatMinutes,
          loincCode: typeof body.loincCode === "string" ? body.loincCode.trim().slice(0, 30) || null : null,
        },
      });

      if (session.activeBranchId) {
        await tx.testBranchAvailability.create({ data: { testId: created.id, branchId: session.activeBranchId, performedHere: true } });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.userId,
          action: "CATALOG_TEST_CREATED",
          entityType: "LabTest",
          entityId: created.id,
          newValues: { code: created.code, nameEn: created.nameEn, nameAr: created.nameAr, workflowType: created.workflowType },
        },
      });
      return created;
    });
    return NextResponse.json({ test }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}
