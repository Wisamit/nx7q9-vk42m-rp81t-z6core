import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EqaWorkspace } from "@/components/eqa-workspace";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic="force-dynamic";
const BATCH=50;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EqaPage({searchParams}:{
  searchParams:Promise<{branch?:string; q?:string; after?:string}>;
}) {
  const session=await requirePermission("qc.view");
  const locale=getUiLocale(session.user.preferredLocale);
  const permissions=permissionSet(session);
  const org=session.user.organizationId;
  const scopes=session.user.branchScopes.filter(s=>s.branch.status==="ACTIVE"&&
    s.branch.organizationId===org).map(s=>s.branchId);
  const params=await searchParams;
  const branchFilter=params.branch&&scopes.includes(params.branch)?params.branch:null;
  const scopeIds=branchFilter?[branchFilter]:scopes;
  const query=(params.q||"").trim().slice(0,80);
  const cursorParts=params.after?.split("|");
  const dateText=cursorParts?.[0]||"";
  const idText=cursorParts?.[1]||"";
  const after=cursorParts?.length===2&&UUID.test(idText)&&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(dateText)&&
    !Number.isNaN(new Date(dateText).getTime())
    ? {createdAt:new Date(dateText),id:idText}:null;
  const whereProgram={
    organizationId:org,branchId:{in:scopeIds},
    ...(query?{OR:[{code:{contains:query}},{providerName:{contains:query}}]}:{}),
  };
  const [branches,programRows,roundRows,components,analyzers]=await Promise.all([
    prisma.branch.findMany({
      where:{id:{in:scopes},organizationId:org,status:"ACTIVE"},
      select:{id:true,code:true,nameEn:true,nameAr:true},
      orderBy:{code:"asc"},
    }),
    prisma.eqaProgram.findMany({
      where:whereProgram,include:{branch:{select:{id:true,code:true,nameEn:true,nameAr:true}}},
      orderBy:[{createdAt:"desc"},{id:"desc"}],take:500,
    }),
    prisma.eqaRound.findMany({
      where:{
        program:whereProgram,
        ...(after?{OR:[
          {createdAt:{lt:after.createdAt}},
          {createdAt:after.createdAt,id:{lt:after.id}},
        ]}:{}),
      },
      include:{
        program:{include:{branch:{select:{id:true,code:true,nameEn:true,nameAr:true}}}},
        observations:{orderBy:[{createdAt:"asc"},{id:"asc"}]},
      },
      orderBy:[{createdAt:"desc"},{id:"desc"}],take:BATCH+1,
    }),
    prisma.testComponent.findMany({
      where:{status:"ACTIVE",test:{organizationId:org,status:"ACTIVE",
        ...(session.user.departmentScopes.filter(d=>d.department.status==="ACTIVE").length?{
          departmentId:{in:session.user.departmentScopes.filter(d=>d.department.status==="ACTIVE")
            .map(d=>d.departmentId)},
        }:{}),
      }},
      include:{test:{select:{code:true}}},
      orderBy:[{test:{code:"asc"}},{code:"asc"}],take:1000,
    }),
    prisma.analyzer.findMany({
      where:{organizationId:org,branchId:{in:scopeIds},status:"ACTIVE"},
      select:{id:true,branchId:true,code:true,name:true},orderBy:{code:"asc"},
      take:500,
    }),
  ]);
  const hasMore=roundRows.length>BATCH;
  const shown=roundRows.slice(0,BATCH);
  const last=shown.at(-1);
  const nextParams=new URLSearchParams();
  if(branchFilter)nextParams.set("branch",branchFilter);
  if(query)nextParams.set("q",query);
  if(last)nextParams.set("after",last.createdAt.toISOString()+"|"+last.id);
  return <main className="catalog-shell filter-workspace">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Quality Management / External Proficiency","إدارة الجودة / اختبارات الكفاءة الخارجية")}</p>
        <h1>{tr(locale,"External Quality Assessment (EQA)","التقييم الخارجي لجودة المختبر (EQA)")}</h1>
        <p className="muted">{tr(locale,
          "Multi-branch proficiency programs, external sample measurements, submission, independent review, provider verdict and archived audit evidence.",
          "برامج الكفاءة متعددة الفروع، قياسات عينات التقييم، تقديم النتائج والمراجعة المستقلة وحكم الجهة الخارجية والأرشفة والتدقيق.")}</p>
      </div>
      <Link className="secondary-link" href="/quality">{tr(locale,"Back to QMS","العودة إلى إدارة الجودة")}</Link>
    </header>
    <section className="detail-section">
      <article className="table-card">
        <h2>{tr(locale,"Scope and program search","نطاق العرض والبحث عن البرامج")}</h2>
        <form method="get" className="settings-grid filter-grid">
          <label>{tr(locale,"Branch","الفرع")}<select name="branch" defaultValue={branchFilter||""}>
            <option value="">{tr(locale,"All my branches","كل الفروع المصرّح بها")}</option>
            {branches.map(branch=><option key={branch.id} value={branch.id}>
              {branch.code} — {locale==="ar"?branch.nameAr||branch.nameEn:branch.nameEn}</option>)}
          </select></label>
          <label>{tr(locale,"Program code / provider","رمز البرنامج / الجهة")}
            <input type="search" name="q" defaultValue={query} maxLength={80}/></label>
          <button className="primary-button">{tr(locale,"Apply filters","تطبيق البحث")}</button>
        </form>
        <p className="muted">{tr(locale,"Visible programs","البرامج المعروضة")}: {programRows.length}
          {" · "}{tr(locale,"Visible rounds on this page","الجولات الظاهرة في الصفحة")}: {shown.length}</p>
        {programRows.length===500&&<p className="form-warning">{tr(locale,
          "Narrow by branch or program name to access more programs.",
          "حدد الفرع أو اسم البرنامج للوصول إلى برامج إضافية.")}</p>}
        {components.length===1000&&<p className="form-warning">{tr(locale,
          "Component selector shows the first 1,000 components. Refine catalog configuration if the needed component is absent.",
          "تعرض قائمة المكوّنات أول ألف مكوّن؛ راجع إعدادات الدليل إذا لم يظهر المطلوب.")}</p>}
      </article>
    </section>
    <EqaWorkspace key={(branchFilter||"ALL")+"|"+query+"|"+(params.after||"FIRST")}
      locale={locale} actorId={session.user.id}
      branches={branches}
      programs={programRows.map(p=>({
        id:p.id,branchId:p.branchId,code:p.code,providerName:p.providerName,
        nameEn:p.nameEn,nameAr:p.nameAr,status:p.status,branch:p.branch,
      }))}
      rounds={shown.map(r=>({
        id:r.id,programId:r.programId,roundCode:r.roundCode,sampleCode:r.sampleCode,
        dueAt:r.dueAt?.toISOString()||null,status:r.status,
        submittedByUserId:r.submittedByUserId,reviewedByUserId:r.reviewedByUserId,
        program:{id:r.program.id,branchId:r.program.branchId,code:r.program.code,
          providerName:r.program.providerName,nameEn:r.program.nameEn,
          nameAr:r.program.nameAr,status:r.program.status,branch:r.program.branch},
        observations:r.observations.map(o=>({
          id:o.id,entryCode:o.entryCode,componentCodeSnapshot:o.componentCodeSnapshot,
          componentNameEnSnapshot:o.componentNameEnSnapshot,
          componentNameArSnapshot:o.componentNameArSnapshot,unitSnapshot:o.unitSnapshot,
          analyzerCodeSnapshot:o.analyzerCodeSnapshot,
          observedValue:o.observedValue,methodSnapshot:o.methodSnapshot,note:o.note,
          assessment:o.assessment,providerExpectedValue:o.providerExpectedValue,
          providerFeedback:o.providerFeedback,createdByUserId:o.createdByUserId,
        })),
      }))}
      components={components.map(c=>({id:c.id,code:c.code,
        nameEn:c.nameEn,nameAr:c.nameAr,testCode:c.test.code}))}
      analyzers={analyzers}
      canManage={permissions.has("qc.manage")}
      canEnter={permissions.has("qc.enter")}
      canResolve={permissions.has("qc.resolve")}/>
    <section className="detail-section">
      {hasMore&&last&&<Link className="secondary-link" href={"/quality/eqa?"+nextParams.toString()}>
        {tr(locale,"Next 50 rounds","الجولات الخمسون التالية")}</Link>}
      {after&&<Link className="secondary-link" href={"/quality/eqa"+(branchFilter||query?
        "?"+new URLSearchParams({...branchFilter?{branch:branchFilter}:{},...query?{q:query}:{}}).toString():"")}>
        {tr(locale,"Return to first page","العودة إلى الصفحة الأولى")}</Link>}
    </section>
  </main>;
}
