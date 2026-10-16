"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CrudModal } from "@/components/crud-modal";

type Branch = {
  id:string;code:string;nameEn:string;nameAr:string|null;timezone:string;defaultCurrency:string;
  phone:string|null;email:string|null;addressEn:string|null;addressAr:string|null;
  isCentralLab:boolean;status:"ACTIVE"|"INACTIVE";workingHours:WeeklyHours|null;
};
type Department = {id:string;code:string;nameEn:string;nameAr:string|null;branchId:string|null;status:"ACTIVE"|"INACTIVE"};
type Workstation = {id:string;code:string;nameEn:string;nameAr:string|null;branchId:string;departmentId:string|null;status:"ACTIVE"|"INACTIVE"};
type Window = {open:string;close:string};
type WeeklyHours={version:1;days:Record<string,Window[]>};
type BranchDraft={code:string;nameEn:string;nameAr:string;timezone:string;defaultCurrency:string;phone:string;email:string;addressEn:string;addressAr:string;isCentralLab:boolean};
type ItemDraft={code:string;nameEn:string;nameAr:string;branchId:string;departmentId:string};
type ApiError={error?:string};
const DAYS=[["mon","Monday","الاثنين"],["tue","Tuesday","الثلاثاء"],["wed","Wednesday","الأربعاء"],
 ["thu","Thursday","الخميس"],["fri","Friday","الجمعة"],["sat","Saturday","السبت"],["sun","Sunday","الأحد"]] as const;
const emptyHours=():WeeklyHours=>({version:1,days:Object.fromEntries(DAYS.map(([key])=>[key,[]]))});
const emptyItem=():ItemDraft=>({code:"",nameEn:"",nameAr:"",branchId:"",departmentId:""});
const initialBranch=(branches:Branch[]):BranchDraft=>({
 code:"",nameEn:"",nameAr:"",timezone:branches[0]?.timezone||"UTC",
 defaultCurrency:branches[0]?.defaultCurrency||"",phone:"",email:"",addressEn:"",addressAr:"",isCentralLab:false,
});
const toBranchDraft=(b:Branch):BranchDraft=>({
 code:b.code,nameEn:b.nameEn,nameAr:b.nameAr||"",timezone:b.timezone,defaultCurrency:b.defaultCurrency,
 phone:b.phone||"",email:b.email||"",addressEn:b.addressEn||"",addressAr:b.addressAr||"",isCentralLab:b.isCentralLab,
});
const title=(item:{nameEn:string;nameAr?:string|null},locale:"ar"|"en")=>locale==="ar"?item.nameAr||item.nameEn:item.nameEn;

export function OrganizationStructureManager({locale,canManage}:{locale:"ar"|"en";canManage:boolean}) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [tab,setTab]=useState<"branches"|"departments"|"workstations">("branches");
  const [branches,setBranches]=useState<Branch[]>([]);
  const [departments,setDepartments]=useState<Department[]>([]);
  const [stations,setStations]=useState<Workstation[]>([]);
  const [canCreate,setCanCreate]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [branchId,setBranchId]=useState("new");
  const [departmentId,setDepartmentId]=useState("new");
  const [stationId,setStationId]=useState("new");
  const [branchDraft,setBranchDraft]=useState<BranchDraft>(initialBranch([]));
  const [departmentDraft,setDepartmentDraft]=useState<ItemDraft>(emptyItem);
  const [stationDraft,setStationDraft]=useState<ItemDraft>(emptyItem);
  const [hours,setHours]=useState<WeeklyHours>(emptyHours);
  const [statusAction,setStatusAction]=useState<{kind:"branches"|"departments"|"workstations";id:string;operation:"deactivate"|"reactivate"}|null>(null);
  const [reason,setReason]=useState("");
  const [branchEditorOpen,setBranchEditorOpen]=useState(false);
  const [departmentEditorOpen,setDepartmentEditorOpen]=useState(false);
  const [stationEditorOpen,setStationEditorOpen]=useState(false);

  const refresh=useCallback(async()=>{
    const endpoints=["/api/organization/branches","/api/organization/departments","/api/organization/workstations"];
    const responses=await Promise.all(endpoints.map(url=>fetch(url,{cache:"no-store"})));
    if(responses.some(response=>!response.ok)) throw Error("permission_or_load_failed");
    const [b,d,w]=await Promise.all(responses.map(response=>response.json()));
    setBranches((b as {branches:Branch[]}).branches);
    setDepartments((d as {departments:Department[]}).departments);
    setStations((w as {workstations:Workstation[]}).workstations);
    setCanCreate((b as {canCreate:boolean}).canCreate);
  },[]);
  useEffect(()=>{
    let alive=true;
    (async()=>{try{await refresh();}catch{if(alive)setMessage(tr("Unable to load organization structure.","تعذر تحميل الهيكل المؤسسي."));}
      finally{if(alive)setLoading(false);}})();
    return()=>{alive=false;};
  // Translation changes only the copy, not the fetch logic.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[refresh]);

  const changeBranch=(id:string)=>{
    setBranchId(id);const found=branches.find(b=>b.id===id);
    setBranchDraft(found?toBranchDraft(found):initialBranch(branches));
    setHours(found?.workingHours&&found.workingHours.version===1?found.workingHours:emptyHours());
    setMessage("");setStatusAction(null);
  };
  const changeDepartment=(id:string)=>{
    setDepartmentId(id);const found=departments.find(x=>x.id===id);
    setDepartmentDraft(found?{code:found.code,nameEn:found.nameEn,nameAr:found.nameAr||"",branchId:found.branchId||"",departmentId:""}:emptyItem());
    setMessage("");setStatusAction(null);
  };
  const changeStation=(id:string)=>{
    setStationId(id);const found=stations.find(x=>x.id===id);
    setStationDraft(found?{code:found.code,nameEn:found.nameEn,nameAr:found.nameAr||"",branchId:found.branchId,departmentId:found.departmentId||""}:emptyItem());
    setMessage("");setStatusAction(null);
  };
  async function mutate(kind:"branches"|"departments"|"workstations",method:"POST"|"PATCH",body:Record<string,unknown>) {
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/organization/"+kind,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>({})) as ApiError;
      if(!response.ok) throw Error(result.error||"save_failed");
      await refresh();
      if(method==="POST"){
        if(kind==="branches") changeBranch("new");
        if(kind==="departments") changeDepartment("new");
        if(kind==="workstations") changeStation("new");
      }
      setStatusAction(null);setReason("");
      setMessage(tr("Saved successfully. Refresh the page after changing branch permissions.","تم الحفظ بنجاح. حدّث الصفحة بعد تغيير صلاحيات الفروع."));
    }catch(e){setMessage(tr("Action failed: ","تعذّر الإجراء: ")+(e instanceof Error?e.message:"unknown_error"));}
    finally{setBusy(false);}
  }
  function saveBranch(e:FormEvent<HTMLFormElement>){
    e.preventDefault();void mutate("branches",branchId==="new"?"POST":"PATCH",
      branchId==="new"?branchDraft:{...branchDraft,code:undefined,id:branchId,operation:"update"});
  }
  function saveDepartment(e:FormEvent<HTMLFormElement>){
    e.preventDefault();void mutate("departments",departmentId==="new"?"POST":"PATCH",
      departmentId==="new"?{...departmentDraft,branchId:departmentDraft.branchId||null}:
        {id:departmentId,operation:"update",nameEn:departmentDraft.nameEn,nameAr:departmentDraft.nameAr});
  }
  function saveStation(e:FormEvent<HTMLFormElement>){
    e.preventDefault();void mutate("workstations",stationId==="new"?"POST":"PATCH",
      stationId==="new"?{...stationDraft,departmentId:stationDraft.departmentId||null}:
        {id:stationId,operation:"update",nameEn:stationDraft.nameEn,nameAr:stationDraft.nameAr,
          departmentId:stationDraft.departmentId||null});
  }
  function setWindow(day:string,index:number,field:"open"|"close",value:string){
    setHours(prev=>({...prev,days:{...prev.days,[day]:(prev.days[day]||[]).map((window,i)=>
      i===index?{...window,[field]:value}:window)}}));
  }
  function addWindow(day:string){
    setHours(prev=>({...prev,days:{...prev.days,[day]:[...(prev.days[day]||[]),{open:"17:00",close:"18:00"}]}}));
  }
  function removeWindow(day:string,index:number){
    setHours(prev=>({...prev,days:{...prev.days,[day]:(prev.days[day]||[]).filter((_,i)=>i!==index)}}));
  }
  const chosenBranch=branches.find(b=>b.id===branchId);
  const chosenDepartment=departments.find(d=>d.id===departmentId);
  const chosenStation=stations.find(s=>s.id===stationId);
  const visibleBranches=branches.filter(b=>b.status==="ACTIVE");
  const possibleDepartments=(branch:string)=>departments.filter(d=>d.status==="ACTIVE"&&(d.branchId===null||d.branchId===branch));
  const editableBranch=canManage&&canCreate;
  if(loading) return <p className="muted">{tr("Loading organization structure…","جارٍ تحميل الهيكل المؤسسي…")}</p>;
  return <div className="detail-section">
    <nav className="inline-actions" aria-label={tr("Structure areas","أقسام الهيكل")}>
      {(["branches","departments","workstations"] as const).map(name=>
        <button key={name} type="button" className={tab===name?"primary-button":"secondary-button"} onClick={()=>setTab(name)}>
          {name==="branches"?tr("Branches","الفروع"):name==="departments"?tr("Departments","الأقسام"):tr("Workstations","محطات العمل")}
        </button>)}
    </nav>
    {message&&<p role="status" className="muted">{message}</p>}
    {tab==="branches"&&<div className="detail-section">
      <section className="table-card">
        <div className="table-toolbar"><h2>{tr("Organization branches","فروع المؤسسة")}</h2>
          {editableBranch&&<button type="button" className="primary-button" disabled={busy}
            onClick={()=>{changeBranch("new");setBranchEditorOpen(true);}}>
            {tr("Add branch","إضافة فرع")}
          </button>}
        </div>
        <div className="table-wrap"><table><thead><tr>
          <th>{tr("Code","الرمز")}</th><th>{tr("Branch","الفرع")}</th><th>{tr("Timezone","المنطقة الزمنية")}</th>
          <th>{tr("Currency","العملة")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Actions","الإجراءات")}</th>
        </tr></thead><tbody>{branches.map(b=><tr key={b.id}>
          <td>{b.code}</td><td>{title(b,locale)}{b.isCentralLab?" · "+tr("Central lab","مختبر مركزي"):""}</td>
          <td dir="ltr">{b.timezone}</td><td>{b.defaultCurrency}</td><td>{b.status}</td>
          <td><div className="inline-actions">
            <button type="button" className="secondary-button" onClick={()=>{changeBranch(b.id);setBranchEditorOpen(true);}}>{tr("View / edit","عرض / تعديل")}</button>
            {editableBranch&&<button className="secondary-button" onClick={()=>{setStatusAction({kind:"branches",id:b.id,operation:b.status==="ACTIVE"?"deactivate":"reactivate"});setReason("");}}>
              {b.status==="ACTIVE"?tr("Deactivate","تعطيل"):tr("Reactivate","إعادة التفعيل")}
            </button>}
          </div></td>
        </tr>)}</tbody></table></div>
      </section>
      <CrudModal open={branchEditorOpen} onClose={()=>{if(!busy)setBranchEditorOpen(false);}}
        size="compact"
        title={tr("Branch details","بيانات الفرع")}
        description={tr("Branch identity and local working hours; all changes require your branch authorization.",
          "هوية الفرع وساعات العمل المحلية؛ تتطلب التعديلات صلاحية الفرع المناسبة.")}>
      {branchEditorOpen&&<section className="detail-card">
        <h2>{tr("Branch details","بيانات الفرع")}</h2>
        <label>{tr("Select branch","اختر الفرع")}<select value={branchId} onChange={e=>changeBranch(e.target.value)}>
          {canCreate&&<option value="new">{tr("Create a branch","إنشاء فرع جديد")}</option>}
          {!canCreate&&<option value="new">{tr("Select…","اختر…")}</option>}
          {branches.map(b=><option key={b.id} value={b.id}>{b.code} · {title(b,locale)}</option>)}
        </select></label>
        {(canCreate||chosenBranch)&&<form onSubmit={saveBranch} className="form-grid">
          <label>{tr("Immutable code","الرمز الثابت")}<input required value={branchDraft.code} maxLength={50}
            disabled={branchId!=="new"||!editableBranch} onChange={e=>setBranchDraft(v=>({...v,code:e.target.value}))}/></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input required maxLength={200} value={branchDraft.nameEn}
            disabled={!editableBranch} onChange={e=>setBranchDraft(v=>({...v,nameEn:e.target.value}))}/></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input maxLength={200} dir="rtl" value={branchDraft.nameAr}
            disabled={!editableBranch} onChange={e=>setBranchDraft(v=>({...v,nameAr:e.target.value}))}/></label>
          <label>{tr("IANA timezone","المنطقة الزمنية IANA")}<input required dir="ltr" maxLength={64} value={branchDraft.timezone}
            disabled={!editableBranch} onChange={e=>setBranchDraft(v=>({...v,timezone:e.target.value}))}/></label>
          <label>{tr("Currency ISO 4217","رمز العملة ISO 4217")}<input required maxLength={3} value={branchDraft.defaultCurrency}
            disabled={!editableBranch} onChange={e=>setBranchDraft(v=>({...v,defaultCurrency:e.target.value.toUpperCase()}))}/></label>
          <label>{tr("Phone","الهاتف")}<input maxLength={50} value={branchDraft.phone} disabled={!editableBranch}
            onChange={e=>setBranchDraft(v=>({...v,phone:e.target.value}))}/></label>
          <label>{tr("Email","البريد الإلكتروني")}<input type="email" maxLength={191} value={branchDraft.email} disabled={!editableBranch}
            onChange={e=>setBranchDraft(v=>({...v,email:e.target.value}))}/></label>
          <label>{tr("English address","العنوان بالإنجليزية")}<input maxLength={2000} value={branchDraft.addressEn} disabled={!editableBranch}
            onChange={e=>setBranchDraft(v=>({...v,addressEn:e.target.value}))}/></label>
          <label>{tr("Arabic address","العنوان بالعربية")}<input maxLength={2000} value={branchDraft.addressAr} disabled={!editableBranch}
            onChange={e=>setBranchDraft(v=>({...v,addressAr:e.target.value}))}/></label>
          <label className="check-row"><input type="checkbox" checked={branchDraft.isCentralLab} disabled={!editableBranch}
            onChange={e=>setBranchDraft(v=>({...v,isCentralLab:e.target.checked}))}/>{tr("Central performing laboratory","مختبر مركزي لتنفيذ الفحوصات")}</label>
          {editableBranch&&<div className="result-actions"><button className="primary-button" type="submit" disabled={busy}>
            {branchId==="new"?tr("Create branch","إنشاء الفرع"):tr("Save branch details","حفظ بيانات الفرع")}
          </button></div>}
        </form>}
        {chosenBranch&&<div className="detail-section">
          <h3>{tr("Local working hours","ساعات العمل المحلية")}</h3>
          <p className="muted">{tr("These hours are administrative information and do not automatically calculate clinical TAT or permit specimen release.",
            "هذه الساعات معلومات إدارية ولا تغيّر آلياً مواعيد النتائج أو صلاحية إصدارها.")}</p>
          {DAYS.map(([day,en,ar])=><div className="inline-actions" key={day}>
            <label className="check-row"><input type="checkbox" checked={(hours.days[day]||[]).length>0}
              disabled={!canManage||chosenBranch.status!=="ACTIVE"}
              onChange={e=>setHours(h=>({...h,days:{...h.days,[day]:e.target.checked?[{open:"09:00",close:"17:00"}]:[]}}))}/>
              {tr(en,ar)}</label>
            {(hours.days[day]||[]).map((window,index)=><div className="inline-actions" key={index}>
              <input aria-label={tr("Opening time","وقت الفتح")+" "+tr(en,ar)+" "+(index+1)}
                type="time" value={window.open} disabled={!canManage}
                onChange={e=>setWindow(day,index,"open",e.target.value)}/>
              <input aria-label={tr("Closing time","وقت الإغلاق")+" "+tr(en,ar)+" "+(index+1)}
                type="time" value={window.close} disabled={!canManage}
                onChange={e=>setWindow(day,index,"close",e.target.value)}/>
              {canManage&&<button type="button" className="secondary-button" onClick={()=>removeWindow(day,index)}>
                {tr("Remove period","حذف الفترة")}</button>}
            </div>)}
            {canManage&&(hours.days[day]||[]).length>0&&(hours.days[day]||[]).length<4&&
              <button type="button" className="secondary-button" onClick={()=>addWindow(day)}>
                {tr("Add period","إضافة فترة")}</button>}
          </div>)}
          {canManage&&chosenBranch.status==="ACTIVE"&&<button type="button" className="secondary-button" disabled={busy}
            onClick={()=>void mutate("branches","PATCH",{id:chosenBranch.id,operation:"hours",workingHours:hours})}>
            {tr("Save weekly schedule","حفظ الجدول الأسبوعي")}
          </button>}
        </div>}
      </section>}
      </CrudModal>
    </div>}
    {tab==="departments"&&<div className="detail-section">
      <section className="table-card"><div className="table-toolbar"><h2>{tr("Departments and sections","الأقسام والوحدات")}</h2>
          {canManage&&<button type="button" className="primary-button" disabled={busy}
            onClick={()=>{changeDepartment("new");setDepartmentEditorOpen(true);}}>
            {tr("Add department","إضافة قسم")}
          </button>}
        </div>
        <div className="table-wrap"><table><thead><tr><th>{tr("Code","الرمز")}</th><th>{tr("Name","الاسم")}</th>
          <th>{tr("Scope","النطاق")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Actions","الإجراءات")}</th></tr></thead>
          <tbody>{departments.map(d=><tr key={d.id}><td>{d.code}</td><td>{title(d,locale)}</td>
            <td>{d.branchId?branches.find(b=>b.id===d.branchId)?.code||"—":tr("Organization-wide","كل الفروع")}</td><td>{d.status}</td>
            <td><div className="inline-actions">
              <button type="button" className="secondary-button" onClick={()=>{changeDepartment(d.id);setDepartmentEditorOpen(true);}}>{tr("View / edit","عرض / تعديل")}</button>
              {canManage&&(d.branchId!==null||canCreate)&&<button className="secondary-button" onClick={()=>setStatusAction({kind:"departments",id:d.id,operation:d.status==="ACTIVE"?"deactivate":"reactivate"})}>
                {d.status==="ACTIVE"?tr("Deactivate","تعطيل"):tr("Reactivate","إعادة التفعيل")}</button>}
            </div></td></tr>)}</tbody></table></div>
      </section>
      <CrudModal open={departmentEditorOpen} onClose={()=>{if(!busy)setDepartmentEditorOpen(false);}}
        size="compact"
        title={tr("Department details","بيانات القسم")}
        description={tr("Department codes and branch scope are immutable after creation.",
          "تبقى رموز الأقسام ونطاق الفرع ثابتة بعد الإنشاء.")}>
      {departmentEditorOpen&&<section className="detail-card">
        <h2>{tr("Department details","بيانات القسم")}</h2>
        <label>{tr("Select department","اختر القسم")}<select value={departmentId} onChange={e=>changeDepartment(e.target.value)}>
          <option value="new">{tr("New department","قسم جديد")}</option>{departments.map(d=><option key={d.id} value={d.id}>{d.code} · {title(d,locale)}</option>)}
        </select></label>
        <form className="form-grid" onSubmit={saveDepartment}>
          <label>{tr("Immutable code","الرمز الثابت")}<input required maxLength={50} value={departmentDraft.code}
            disabled={departmentId!=="new"||!canManage} onChange={e=>setDepartmentDraft(v=>({...v,code:e.target.value}))}/></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input required maxLength={150} value={departmentDraft.nameEn}
            disabled={!canManage} onChange={e=>setDepartmentDraft(v=>({...v,nameEn:e.target.value}))}/></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input maxLength={150} dir="rtl" value={departmentDraft.nameAr}
            disabled={!canManage} onChange={e=>setDepartmentDraft(v=>({...v,nameAr:e.target.value}))}/></label>
          <label>{tr("Department scope (immutable)","نطاق القسم (ثابت)")}
            <select value={departmentDraft.branchId} disabled={!canManage||departmentId!=="new"}
              onChange={e=>setDepartmentDraft(v=>({...v,branchId:e.target.value}))}>
              {canCreate&&<option value="">{tr("Shared by organization","مشترك بين الفروع")}</option>}
              {!canCreate&&<option value="">{tr("Select branch","اختر الفرع")}</option>}
              {visibleBranches.map(b=><option value={b.id} key={b.id}>{b.code} · {title(b,locale)}</option>)}
            </select>
          </label>
          {canManage&&(!chosenDepartment||chosenDepartment.status==="ACTIVE")&&(departmentId==="new"||chosenDepartment?.branchId||canCreate)&&
            <button type="submit" className="primary-button" disabled={busy}>{departmentId==="new"?tr("Create department","إنشاء قسم"):tr("Save department","حفظ القسم")}</button>}
        </form>
      </section>}
      </CrudModal>
    </div>}
    {tab==="workstations"&&<div className="detail-section">
      <section className="table-card"><div className="table-toolbar"><h2>{tr("Operational workstations","محطات العمل التشغيلية")}</h2>
          {canManage&&<button type="button" className="primary-button" disabled={busy}
            onClick={()=>{changeStation("new");setStationEditorOpen(true);}}>
            {tr("Add workstation","إضافة محطة عمل")}
          </button>}
        </div>
        <div className="table-wrap"><table><thead><tr><th>{tr("Code","الرمز")}</th><th>{tr("Name","الاسم")}</th>
          <th>{tr("Branch","الفرع")}</th><th>{tr("Department","القسم")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Actions","الإجراءات")}</th></tr></thead>
          <tbody>{stations.map(s=><tr key={s.id}><td>{s.code}</td><td>{title(s,locale)}</td>
            <td>{branches.find(b=>b.id===s.branchId)?.code||"—"}</td>
            <td>{departments.find(d=>d.id===s.departmentId)?.code||"—"}</td><td>{s.status}</td>
            <td><div className="inline-actions"><button type="button" className="secondary-button" onClick={()=>{changeStation(s.id);setStationEditorOpen(true);}}>{tr("View / edit","عرض / تعديل")}</button>
              {canManage&&<button className="secondary-button" onClick={()=>setStatusAction({kind:"workstations",id:s.id,operation:s.status==="ACTIVE"?"deactivate":"reactivate"})}>
                {s.status==="ACTIVE"?tr("Deactivate","تعطيل"):tr("Reactivate","إعادة التفعيل")}</button>}
            </div></td></tr>)}</tbody></table></div>
      </section>
      <CrudModal open={stationEditorOpen} onClose={()=>{if(!busy)setStationEditorOpen(false);}}
        size="compact"
        title={tr("Workstation details","بيانات محطة العمل")}
        description={tr("Workstations remain branch-scoped; only qualified staff can update them.",
          "تبقى محطات العمل محصورة ضمن فروعها، ولا يحق تعديلها إلا للمخولين.")}>
      {stationEditorOpen&&<section className="detail-card"><h2>{tr("Workstation details","بيانات محطة العمل")}</h2>
        <label>{tr("Select workstation","اختر المحطة")}<select value={stationId} onChange={e=>changeStation(e.target.value)}>
          <option value="new">{tr("New workstation","محطة عمل جديدة")}</option>{stations.map(s=><option key={s.id} value={s.id}>{s.code} · {title(s,locale)}</option>)}
        </select></label>
        <form className="form-grid" onSubmit={saveStation}>
          <label>{tr("Immutable code","الرمز الثابت")}<input required maxLength={50} value={stationDraft.code}
            disabled={stationId!=="new"||!canManage} onChange={e=>setStationDraft(v=>({...v,code:e.target.value}))}/></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input required maxLength={150} value={stationDraft.nameEn}
            disabled={!canManage} onChange={e=>setStationDraft(v=>({...v,nameEn:e.target.value}))}/></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input maxLength={150} dir="rtl" value={stationDraft.nameAr}
            disabled={!canManage} onChange={e=>setStationDraft(v=>({...v,nameAr:e.target.value}))}/></label>
          <label>{tr("Branch (immutable)","الفرع (ثابت)")}<select required value={stationDraft.branchId} disabled={!canManage||stationId!=="new"}
            onChange={e=>setStationDraft(v=>({...v,branchId:e.target.value,departmentId:""}))}>
            <option value="">{tr("Select branch","اختر الفرع")}</option>
            {visibleBranches.map(b=><option key={b.id} value={b.id}>{b.code} · {title(b,locale)}</option>)}
          </select></label>
          <label>{tr("Department","القسم")}<select value={stationDraft.departmentId} disabled={!canManage||stationDraft.branchId===""}
            onChange={e=>setStationDraft(v=>({...v,departmentId:e.target.value}))}>
            <option value="">{tr("No department","بدون قسم")}</option>
            {possibleDepartments(stationDraft.branchId).map(d=><option key={d.id} value={d.id}>{d.code} · {title(d,locale)}</option>)}
          </select></label>
          {canManage&&(!chosenStation||chosenStation.status==="ACTIVE")&&
            <button type="submit" className="primary-button" disabled={busy}>{stationId==="new"?tr("Create workstation","إنشاء محطة عمل"):tr("Save workstation","حفظ محطة العمل")}</button>}
        </form>
      </section>}
      </CrudModal>
    </div>}
    <CrudModal open={statusAction!==null} onClose={()=>{if(!busy)setStatusAction(null);}}
      size="compact"
      title={tr("Confirm structure status change","تأكيد تغيير حالة الهيكل")}
      description={tr("Reasoned status changes preserve historical references and are enforced server-side.",
        "يحافظ تغيير الحالة الموثق على المراجع التاريخية وتتحقق منه صلاحيات السيرفر.")}>
    {statusAction&&<section className="detail-card">
      <h3>{statusAction.operation==="deactivate"?tr("Confirm deactivation","تأكيد التعطيل"):tr("Confirm reactivation","تأكيد إعادة التفعيل")}</h3>
      <p className="muted">{tr("Deactivation preserves history. Branch closure is blocked while any operational/historical references remain.",
        "التعطيل يحافظ على السجلات السابقة. إغلاق الفرع ممنوع ما دام مرتبطاً بسجلات تشغيلية أو تاريخية.")}</p>
      {statusAction.operation==="deactivate"&&<label>{tr("Reason (at least 15 characters)","السبب (15 حرفاً على الأقل)")}
        <textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} /></label>}
      <div className="result-actions">
        <button className="secondary-button" disabled={busy} onClick={()=>setStatusAction(null)}>{tr("Cancel","إلغاء")}</button>
        <button className="primary-button" disabled={busy||(statusAction.operation==="deactivate"&&reason.trim().length<15)}
          onClick={()=>void mutate(statusAction.kind,"PATCH",{id:statusAction.id,operation:statusAction.operation,reason})}>
          {tr("Confirm","تأكيد")}</button>
      </div>
    </section>}
    </CrudModal>
  </div>;
}
