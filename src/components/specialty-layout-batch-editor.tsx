"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SpecialtyLayoutPlan, SpecialtySection, SpecialtyComponent, SpecialtyFieldWidth, SpecialtyLayoutMode } from "@/lib/specialty-layout-review";

type Section = SpecialtySection & {id:string;status:string};
type Component = Omit<SpecialtyComponent,"sectionCode"> & {
  id:string;nameEn:string;nameAr:string|null;resultSectionId:string|null;status:string;
};
type Preview = {
  layoutChanged:boolean;sectionsCreated:string[];sectionsUpdated:string[];
  componentsUpdated:string[];unchangedActiveSections:string[];affected:number;warnings:string[];
};
const widths:SpecialtyFieldWidth[]=["AUTO","NARROW","STANDARD","WIDE","FULL"];
const layouts:SpecialtyLayoutMode[]=["STANDARD","SECTIONED","COMPACT_GRID"];

export function SpecialtyLayoutBatchEditor({
  testId,locale,layout,sections,components,
}:{
  testId:string;locale:"ar"|"en";layout:SpecialtyLayoutMode;
  sections:Section[];components:Component[];
}){
  const router=useRouter(),tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const sectionById=new Map(sections.map(s=>[s.id,s]));
  const [draft,setDraft]=useState<SpecialtyLayoutPlan>(()=>({
    layout,
    sections:sections.filter(s=>s.status==="ACTIVE").map(s=>({
      code:s.code,nameEn:s.nameEn,nameAr:s.nameAr,displayOrder:s.displayOrder,
      columnCount:s.columnCount,hintEn:s.hintEn,hintAr:s.hintAr,
    })),
    components:components.filter(c=>c.status==="ACTIVE").map(c=>({
      code:c.code,sectionCode:c.resultSectionId&&sectionById.get(c.resultSectionId)?.status==="ACTIVE"?
        sectionById.get(c.resultSectionId)!.code:null,
      entryWidth:c.entryWidth,entryHintEn:c.entryHintEn,entryHintAr:c.entryHintAr,
    })),
  }));
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [fingerprint,setFingerprint]=useState("");
  const [reviewToken,setReviewToken]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const label=(item:{nameEn:string;nameAr?:string|null})=>locale==="ar"?item.nameAr||item.nameEn:item.nameEn;
  const invalidate=()=>{setPreview(null);setFingerprint("");setReviewToken("");setConfirmed(false);setResult("");};
  const update=(value:SpecialtyLayoutPlan)=>{setDraft(value);invalidate();};
  const editSection=(index:number,patch:Partial<SpecialtySection>)=>update({...draft,
    sections:draft.sections.map((section,i)=>i===index?{...section,...patch}:section),
  });
  const editComponent=(code:string,patch:Partial<SpecialtyComponent>)=>update({...draft,
    components:draft.components.map(c=>c.code===code?{...c,...patch}:c),
  });
  const busy=loading;
  async function submit(mode:"PREVIEW"|"APPLY"){
    setLoading(true);setResult("");
    try{
      const response=await fetch("/api/catalog/specialty-layout-batch",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({testId,mode,plan:draft,
          ...(mode==="APPLY"?{fingerprint,reviewToken,confirm:"APPLY_REVIEWED_LAYOUT"}:{})}),
      });
      const body=await response.json() as {
        status?:string;error?:string;fingerprint?:string;reviewToken?:string;preview?:Preview;
      };
      if(!response.ok)throw Error(body.error||"request_failed");
      if(mode==="PREVIEW"){
        setPreview(body.preview||null);setFingerprint(body.fingerprint||"");
        setReviewToken(body.reviewToken||"");setConfirmed(false);
        setResult(tr("Preview ready. Verify all changes before applying.",
          "المعاينة جاهزة. راجع جميع التعديلات قبل تطبيقها."));
      }else{
        invalidate();
        setResult(tr("The complete layout was applied atomically and audited. Refreshing…",
          "تم تطبيق التخطيط دفعة واحدة وتسجيل التغييرات. جارٍ التحديث…"));
        router.refresh();
      }
    }catch(e){
      setPreview(null);setConfirmed(false);
      setResult(tr("Unable to proceed: ","تعذّر المتابعة: ")+(e instanceof Error?e.message:"unknown_error"));
    }finally{setLoading(false);}
  }
  const sectionCodes=new Set(draft.sections.map(s=>s.code));
  const activeComponents=components.filter(c=>c.status==="ACTIVE");
  const knownSections=new Set(sections.map(s=>s.code));
  return <article className="detail-card detail-section" dir={locale==="ar"?"rtl":"ltr"}>
    <h3>{tr("Specialty Layout — Review & Apply Together","تخطيط الفحص المتخصص — معاينة وتطبيق جماعي")}</h3>
    <p className="muted">{tr(
      "Configure all sections, field widths and component assignments as one reviewed change. Codes identify the existing configured test components; no clinical values, reference ranges or released reports are modified.",
      "هيّئ الأقسام وعرض الحقول وربط المكونات ضمن تعديل واحد قابل للمراجعة. رموز المكونات مأخوذة من الفحص المهيأ؛ لن تتغير النتائج الطبية أو المجالات المرجعية أو التقارير الصادرة."
    )}</p>
    <label>{tr("Workspace mode","نوع مساحة إدخال النتائج")}
      <select value={draft.layout} disabled={busy} onChange={e=>update({...draft,layout:e.target.value as SpecialtyLayoutMode})}>
        {layouts.map(l=><option key={l} value={l}>{l==="STANDARD"?tr("Standard","قياسي"):
          l==="SECTIONED"?tr("Sectioned","مقسّم"):tr("Compact grid","شبكة مدمجة")}</option>)}
      </select>
    </label>
    <div className="table-toolbar">
      <h4>{tr("Planned sections","الأقسام المخطط لها")} ({draft.sections.length})</h4>
      <button type="button" className="secondary-button" disabled={busy||draft.sections.length>=80}
        onClick={()=>update({...draft,sections:[...draft.sections,{
          code:"",nameEn:"",nameAr:null,displayOrder:draft.sections.length*10,columnCount:2,
          hintEn:null,hintAr:null,
        }]})}>{tr("Add section","إضافة قسم")}</button>
    </div>
    <div className="table-wrap"><table>
      <thead><tr>
        <th>{tr("Code","الرمز")}</th><th>{tr("English name","الاسم بالإنجليزية")}</th>
        <th>{tr("Arabic name","الاسم بالعربية")}</th><th>{tr("Order","الترتيب")}</th>
        <th>{tr("Columns","الأعمدة")}</th><th>{tr("Instructions EN / AR","تعليمات EN / AR")}</th><th>{tr("Action","الإجراء")}</th>
      </tr></thead>
      <tbody>{draft.sections.map((s,i)=><tr key={i}>
        <td><input value={s.code} maxLength={80} disabled={busy||knownSections.has(s.code)}
          aria-label={tr("Section code","رمز القسم")+" "+(i+1)}
          onChange={e=>editSection(i,{code:e.target.value.toUpperCase()})}/></td>
        <td><input value={s.nameEn} maxLength={200} disabled={busy}
          aria-label={tr("Section name EN","اسم القسم EN")+" "+(i+1)}
          onChange={e=>editSection(i,{nameEn:e.target.value})}/></td>
        <td><input dir="rtl" value={s.nameAr||""} maxLength={200} disabled={busy}
          aria-label={tr("Section name AR","اسم القسم AR")+" "+(i+1)}
          onChange={e=>editSection(i,{nameAr:e.target.value||null})}/></td>
        <td><input type="number" min={0} max={10000} value={s.displayOrder} disabled={busy}
          aria-label={tr("Section order","ترتيب القسم")+" "+(i+1)}
          onChange={e=>editSection(i,{displayOrder:Number(e.target.value)})}/></td>
        <td><select value={s.columnCount} disabled={busy} aria-label={tr("Grid columns","أعمدة الشبكة")+" "+(i+1)}
          onChange={e=>editSection(i,{columnCount:Number(e.target.value)})}>
          {[1,2,3,4].map(count=><option key={count} value={count}>{count}</option>)}
        </select></td>
        <td><input maxLength={500} value={s.hintEn||""} disabled={busy} placeholder={tr("English guidance","تعليمات إنجليزية")}
          aria-label={tr("Section hint EN","تعليمات القسم EN")+" "+(i+1)}
          onChange={e=>editSection(i,{hintEn:e.target.value||null})}/>
          <input dir="rtl" maxLength={500} value={s.hintAr||""} disabled={busy} placeholder={tr("Arabic guidance","تعليمات عربية")}
          aria-label={tr("Section hint AR","تعليمات القسم AR")+" "+(i+1)}
          onChange={e=>editSection(i,{hintAr:e.target.value||null})}/></td>
        <td><button type="button" className="secondary-button" disabled={busy}
          onClick={()=>update({
            ...draft,sections:draft.sections.filter((_,index)=>index!==i),
            components:draft.components.map(c=>c.sectionCode===s.code?{...c,sectionCode:null}:c),
          })}>{tr("Exclude from plan","استبعاد من الخطة")}</button></td>
      </tr>)}</tbody>
    </table></div>
    <p className="muted">{tr(
      "Existing sections excluded from this plan remain active and unchanged. No section or clinical component is deleted.",
      "الأقسام الحالية المستبعدة من الخطة تبقى نشطة وبدون تعديل. لا يُحذف أي قسم أو مكوّن سريري."
    )}</p>
    <h4>{tr("Every active test component must appear exactly once","يجب إظهار كل مكوّن نشط مرة واحدة تماماً")} ({activeComponents.length})</h4>
    <div className="table-wrap"><table>
      <thead><tr><th>{tr("Component","المكوّن")}</th><th>{tr("Section","القسم")}</th><th>{tr("Entry width","عرض الحقل")}</th>
        <th>{tr("English entry guidance","تعليمات الإدخال EN")}</th><th>{tr("Arabic entry guidance","تعليمات الإدخال AR")}</th></tr></thead>
      <tbody>{activeComponents.map(c=>{
        const item=draft.components.find(p=>p.code===c.code);
        if(!item)return <tr key={c.id}><td colSpan={5}>{c.code} — {tr("Missing component (reload)","المكوّن مفقود (حدّث الصفحة)")}</td></tr>;
        return <tr key={c.id}>
          <td><strong>{c.code} — {label(c)}</strong></td>
          <td><select value={item.sectionCode||""} disabled={busy}
            onChange={e=>editComponent(c.code,{sectionCode:e.target.value||null})}>
            <option value="">{tr("Other / Ungrouped","أخرى / بدون قسم")}</option>
            {draft.sections.filter(s=>s.code&&sectionCodes.has(s.code)).map((s,i)=><option key={i} value={s.code}>{s.code} — {label(s)}</option>)}
          </select></td>
          <td><select value={item.entryWidth} disabled={busy}
            onChange={e=>editComponent(c.code,{entryWidth:e.target.value as SpecialtyFieldWidth})}>
            {widths.map(w=><option key={w} value={w}>{w}</option>)}
          </select></td>
          <td><input value={item.entryHintEn||""} maxLength={500} disabled={busy}
            aria-label={tr("Entry hint EN","تعليمات الإدخال EN")+" "+c.code}
            onChange={e=>editComponent(c.code,{entryHintEn:e.target.value||null})}/></td>
          <td><input dir="rtl" value={item.entryHintAr||""} maxLength={500} disabled={busy}
            aria-label={tr("Entry hint AR","تعليمات الإدخال AR")+" "+c.code}
            onChange={e=>editComponent(c.code,{entryHintAr:e.target.value||null})}/></td>
        </tr>;
      })}</tbody></table></div>
    <div className="result-actions">
      <button type="button" className="primary-button" disabled={busy}
        onClick={()=>void submit("PREVIEW")}>{loading?tr("Checking…","جارٍ التحقق…"):tr("Preview all changes","معاينة جميع التعديلات")}</button>
    </div>
    {preview&&<div className="detail-section">
      <h4>{tr("Server-reviewed impact","أثر التعديل حسب معاينة الخادم")}</h4>
      <p>{tr("Affected configuration items: ","عناصر الإعداد المتأثرة: ")}<strong>{preview.affected}</strong></p>
      <ul>
        <li>{tr("Layout changed: ","تغيير التخطيط: ")}{preview.layoutChanged?tr("Yes","نعم"):tr("No","لا")}</li>
        <li>{tr("Sections added: ","أقسام جديدة: ")}{preview.sectionsCreated.join(", ")||"—"}</li>
        <li>{tr("Sections revised: ","أقسام معدلة: ")}{preview.sectionsUpdated.join(", ")||"—"}</li>
        <li>{tr("Components reassigned or resized: ","مكوّنات أُعيد ربطها أو تغيير عرضها: ")}
          {preview.componentsUpdated.join(", ")||"—"}</li>
        <li>{tr("Existing sections left unchanged: ","أقسام قائمة لم تتغير: ")}
          {preview.unchangedActiveSections.join(", ")||"—"}</li>
      </ul>
      {preview.warnings.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
      <label className="check-row"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={e=>setConfirmed(e.target.checked)}/>{tr(
          "I reviewed the exact component-to-section mapping and understand that new reports may use the new layout.",
          "راجعت ربط جميع المكوّنات بالأقسام، وأفهم أن التقارير الجديدة قد تستخدم التخطيط الجديد."
        )}</label>
      <button type="button" className="primary-button" disabled={!confirmed||busy||!fingerprint||!reviewToken}
        onClick={()=>void submit("APPLY")}>{tr("Apply reviewed layout atomically","تطبيق التخطيط المعتمد دفعة واحدة")}</button>
    </div>}
    {result&&<p role="status" className="muted">{result}</p>}
  </article>;
}
