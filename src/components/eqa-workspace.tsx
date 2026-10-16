"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Branch = { id:string;code:string;nameEn:string;nameAr:string|null };
type Program = { id:string;branchId:string;code:string;providerName:string;nameEn:string;
  nameAr:string|null;status:string;branch:Branch };
type Round = {id:string;programId:string;roundCode:string;sampleCode:string;
  dueAt:string|null;status:"OPEN"|"SUBMITTED"|"ASSESSED"|"CLOSED";
  submittedByUserId:string|null;reviewedByUserId:string|null;program:Program;
  observations:Observation[]};
type Observation = {id:string;entryCode:string;componentCodeSnapshot:string;
  componentNameEnSnapshot:string;componentNameArSnapshot:string|null;
  unitSnapshot:string|null;analyzerCodeSnapshot:string|null;
  observedValue:string;methodSnapshot:string|null;note:string|null;
  assessment:string|null;providerExpectedValue:string|null;providerFeedback:string|null;
  createdByUserId:string};
type Component = {id:string;code:string;nameEn:string;nameAr:string|null;testCode:string};
type Analyzer = {id:string;code:string;name:string;branchId:string};

export function EqaWorkspace({locale,actorId,branches,programs,rounds,components,analyzers,
  canManage,canEnter,canResolve}:{
  locale:"ar"|"en";actorId:string;branches:Branch[];programs:Program[];
  rounds:Round[];components:Component[];analyzers:Analyzer[];
  canManage:boolean;canEnter:boolean;canResolve:boolean;
}) {
  const router=useRouter();
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [editor,setEditor]=useState("");
  const [currentBranch,setCurrentBranch]=useState(branches[0]?.id||"");
  const [selectedProgram,setSelectedProgram]=useState(programs[0]?.id||"");
  const [selectedRound,setSelectedRound]=useState(rounds[0]?.id||"");
  const currentRound=rounds.find(r=>r.id===selectedRound);
  const selectedProgramItem=programs.find(p=>p.id===selectedProgram);
  async function send(action:string,event:FormEvent<HTMLFormElement>,extra:Record<string,unknown>={}) {
    event.preventDefault();
    if(busy)return;
    const form=event.currentTarget;
    const data=Object.fromEntries(new FormData(form).entries());
    if (action==="CREATE_ROUND" && typeof data.dueAt==="string" && data.dueAt) {
      const parsed=new Date(data.dueAt);
      if (!Number.isFinite(parsed.getTime())) {
        setMessage(tr("Invalid local due date.","الموعد المحلي غير صحيح."));return;
      }
      data.dueAt=parsed.toISOString();
    }
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/quality/eqa",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...data,...extra,action}),
      });
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) {
        setMessage(tr("Operation was not saved: ","لم تُحفظ العملية: ")+(result.error||"unknown_error"));
      }else{
        setMessage(tr("Saved and audited. Refreshing records.","تم الحفظ والتوثيق، جاري تحديث السجلات."));
        setEditor("");
        form.reset();
        router.refresh();
      }
    }catch{setMessage(tr("Connection failed; confirm the latest state before retrying.",
      "فشل الاتصال؛ تأكد من آخر حالة قبل إعادة المحاولة."));}
    finally{setBusy(false);}
  }
  const availablePrograms=programs.filter(p=>p.status==="ACTIVE"&&p.branchId===currentBranch);
  const date=(value:string|null)=>value?new Date(value).toLocaleString(locale==="ar"?"ar-EG":"en-GB"):"—";
  return <div className="detail-grid">
    {message&&<article className="detail-card"><p role="status" className="form-warning">{message}</p></article>}
    {canManage&&<article className="detail-card">
      <h2>{tr("1. Register external proficiency program","1. تسجيل برنامج الكفاءة الخارجية")}</h2>
      <p className="muted">{tr("Provider programs are separate per branch. No patient results are affected.",
        "البرامج مستقلة لكل فرع ولا تؤثر على نتائج المرضى.")}</p>
      <button type="button" className="primary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("program");}}>
   {tr("Register EQA Program","تسجيل برنامج تقييم خارجي")}
  </button>
  <CrudModal open={editor==="program"} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Register EQA Program","تسجيل برنامج تقييم خارجي")}
    description={tr("Branch-specific external quality program. This does not enter patient results.","برنامج جودة خارجية محصور بالفرع؛ لا يسجّل نتائج مرضى.")}
    size="compact">
    {editor==="program"&&<form className="form-stack" onSubmit={e=>void send("CREATE_PROGRAM",e)}>
        <label>{tr("Branch","الفرع")}<select name="branchId" required value={currentBranch}
          onChange={e=>setCurrentBranch(e.target.value)}>
          {branches.map(b=><option key={b.id} value={b.id}>{b.code} — {locale==="ar"?b.nameAr||b.nameEn:b.nameEn}</option>)}
        </select></label>
        <label>{tr("Program code","رمز البرنامج")}<input name="code" required maxLength={80}/></label>
        <label>{tr("External provider","الجهة الخارجية")}<input name="providerName" required maxLength={220}/></label>
        <label>{tr("Program name (English)","اسم البرنامج بالإنجليزية")}<input name="nameEn" required maxLength={220}/></label>
        <label>{tr("Program name (Arabic)","اسم البرنامج بالعربية")}<input name="nameAr" dir="rtl" maxLength={220}/></label>
        <button className="primary-button" disabled={busy}>{tr("Register program","تسجيل البرنامج")}</button>
      </form>}
  </CrudModal>
    </article>}
    {canEnter&&<article className="detail-card">
      <h2>{tr("2. Create provider round","2. إنشاء جولة فحص خارجية")}</h2>
      <button type="button" className="primary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("round");}}>
   {tr("Create EQA Provider Round","إنشاء جولة تقييم خارجي")}
  </button>
  <CrudModal open={editor==="round"} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Create EQA Provider Round","إنشاء جولة تقييم خارجي")}
    description={tr("Check external sample identity, provider program and submission due time.","راجع هوية العينة الخارجية والبرنامج وموعد تقديم القياسات.")}
    size="compact">
    {editor==="round"&&<form className="form-stack" onSubmit={e=>void send("CREATE_ROUND",e)}>
        <label>{tr("Program","البرنامج")}<select name="programId" required value={selectedProgram}
          onChange={e=>setSelectedProgram(e.target.value)}>
          <option value="">{tr("Choose","اختر")}</option>
          {programs.filter(p=>p.status==="ACTIVE").map(p=><option key={p.id} value={p.id}>
            {p.branch.code} / {p.code} — {p.providerName}</option>)}
        </select></label>
        <label>{tr("Provider round code","رمز الجولة")}<input name="roundCode" required maxLength={80}/></label>
        <label>{tr("External sample identifier","معرّف عينة التقييم")}<input name="sampleCode" required maxLength={120}/></label>
        <label>{tr("Submission deadline (your browser local time; optional)","الموعد النهائي بالتوقيت المحلي للمتصفح (اختياري)")}
          <input name="dueAt" type="datetime-local"/></label>
        <button className="primary-button" disabled={busy||!selectedProgramItem}>{tr("Create open round","إنشاء جولة مفتوحة")}</button>
      </form>}
  </CrudModal>
    </article>}
    {canEnter&&<article className="detail-card">
      <h2>{tr("3. Enter EQA observations","3. تسجيل قياسات عينة الكفاءة")}</h2>
      <p className="muted">{tr("These are EQA sample values, never patient laboratory results. Text and units are snapshotted at entry.",
        "هذه نتائج عينات كفاءة خارجية وليست نتائج مرضى. يُحفظ النص والوحدة وقت الإدخال.")}</p>
      <button type="button" className="primary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("observation");}}>
   {tr("Record EQA Observation","تسجيل قراءة عينة تقييم خارجي")}
  </button>
  <CrudModal open={editor==="observation"} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Record EQA Observation","تسجيل قراءة عينة تقييم خارجي")}
    description={tr("This captures only external proficiency sample measurements, never patient results.","يسجّل قياسات عينات الكفاءة الخارجية فقط، وليس نتائج المرضى.")}
    size="compact">
    {editor==="observation"&&<form className="form-stack" onSubmit={e=>void send("ADD_OBSERVATION",e)}>
        <label>{tr("Open round","جولة مفتوحة")}<select name="roundId" required value={selectedRound}
          onChange={e=>setSelectedRound(e.target.value)}>
          <option value="">{tr("Choose round","اختر الجولة")}</option>
          {rounds.filter(r=>r.status==="OPEN").map(r=><option key={r.id} value={r.id}>
            {r.program.branch.code} / {r.program.code} / {r.roundCode}</option>)}
        </select></label>
        <label>{tr("Entry/replicate code","رمز القراءة أو التكرار")}<input name="entryCode" required maxLength={80}/></label>
        <label>{tr("Test component","مكوّن الفحص")}<select name="componentId" required>
          <option value="">{tr("Choose component","اختر المكوّن")}</option>
          {components.map(c=><option key={c.id} value={c.id}>
            {c.testCode}/{c.code} — {locale==="ar"?c.nameAr||c.nameEn:c.nameEn}</option>)}
        </select></label>
        <label>{tr("Analyzer (optional)","جهاز التحليل (اختياري)")}<select name="analyzerId">
          <option value="">{tr("Manual / not specified","يدوي / غير محدد")}</option>
          {analyzers.filter(a=>a.branchId===currentRound?.program.branchId).map(a=>
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select></label>
        <label>{tr("Observed value","القيمة المقاسة")}<input name="observedValue" required maxLength={300}/></label>
        <label>{tr("Method (optional)","الطريقة (اختياري)")}<input name="methodSnapshot" maxLength={220}/></label>
        <label>{tr("Notes","ملاحظات")}<textarea name="note" maxLength={1000} rows={2}/></label>
        <button className="primary-button" disabled={busy||currentRound?.status!=="OPEN"}>
          {tr("Record measurement","تسجيل القياس")}</button>
      </form>}
  </CrudModal>
    </article>}
    <article className="detail-card">
      <h2>{tr("4. Program and round worklist","4. قائمة عمل البرامج والجولات")}</h2>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Branch / Provider","الفرع / الجهة")}</th>
          <th>{tr("Program / Round","البرنامج / الجولة")}</th>
          <th>{tr("Status / Due","الحالة / الموعد")}</th>
          <th>{tr("Observations","القياسات")}</th>
          <th>{tr("Actions","العمليات")}</th>
        </tr></thead>
        <tbody>{rounds.length===0?<tr><td colSpan={5}>{tr("No rounds yet.","لا توجد جولات بعد.")}</td></tr>:
          rounds.map(r=><tr key={r.id}>
          <td>{r.program.branch.code}<small className="table-subtext">{r.program.providerName}</small></td>
          <td><strong>{r.program.code} / {r.roundCode}</strong>
            <small className="table-subtext">{tr("Sample","العينة")}: {r.sampleCode}</small></td>
          <td>{r.status}<small className="table-subtext">{date(r.dueAt)}</small></td>
          <td><strong>{r.observations.length}</strong>
            <small className="table-subtext">{r.observations.filter(o=>o.assessment!==null).length} {tr("assessed","مُقيّمة")}</small></td>
          <td>
            {canEnter&&r.status==="OPEN"&&<><button type="button" className="secondary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("submit:"+r.id);}}>
   {tr("Submit EQA Measurements","تقديم قياسات التقييم الخارجي")}
  </button>
  <CrudModal open={editor==="submit:"+r.id} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Submit EQA Measurements","تقديم قياسات التقييم الخارجي")}
    description={tr("Submission freezes EQA measurements for independent assessment; include a documented reason.","يُثبّت التقديم قياسات التقييم للمراجعة المستقلة؛ أدرج سبباً موثقاً.")}
    size="compact">
    {editor==="submit:"+r.id&&<form onSubmit={e=>void send("SUBMIT_ROUND",e,{roundId:r.id})}
              className="form-stack">
              <input name="reason" placeholder={tr("Submission reason (10+ chars)","سبب تقديم النتائج (10 أحرف)") } required minLength={10} maxLength={1000}/>
              <button className="secondary-button" disabled={busy||r.observations.length===0}>
                {tr("Submit results","تقديم النتائج")}</button></form>}
    {editor==="submit:"+r.id&&message&&<p role="alert" className="form-warning">{message}</p>}
  </CrudModal></>}
            {canResolve&&r.status==="SUBMITTED"&&r.reviewedByUserId===actorId&&
              r.observations.length>0&&r.observations.every(o=>o.assessment!==null)&&
              <><button type="button" className="secondary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("finalize:"+r.id);}}>
   {tr("Finalize Independent EQA Review","اعتماد مراجعة التقييم المستقلة")}
  </button>
  <CrudModal open={editor==="finalize:"+r.id} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Finalize Independent EQA Review","اعتماد مراجعة التقييم المستقلة")}
    description={tr("Only an independently qualified reviewer may finalize all assessed observations.","لا يحق الاعتماد النهائي إلا لمراجع مستقل مؤهل بعد تقييم كل القراءات.")}
    size="compact">
    {editor==="finalize:"+r.id&&<form onSubmit={e=>void send("FINALIZE_REVIEW",e,{roundId:r.id})} className="form-stack">
                <input name="reason" placeholder={tr("Independent review justification","تبرير المراجعة المستقلة")} required minLength={10} maxLength={1000}/>
                <button className="secondary-button" disabled={busy}>{tr("Finalize review","اعتماد المراجعة")}</button>
              </form>}
    {editor==="finalize:"+r.id&&message&&<p role="alert" className="form-warning">{message}</p>}
  </CrudModal></>}
            {canResolve&&r.status==="ASSESSED"&&
              <><button type="button" className="secondary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("close:"+r.id);}}>
   {tr("Close EQA Round","إغلاق جولة تقييم خارجي")}
  </button>
  <CrudModal open={editor==="close:"+r.id} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Close EQA Round","إغلاق جولة تقييم خارجي")}
    description={tr("Closing is audited and retains immutable measurements, verdicts and follow-up references.","يُسجّل الإغلاق في التدقيق مع الاحتفاظ بالقياسات والأحكام ومراجع المتابعة.")}
    size="compact">
    {editor==="close:"+r.id&&<form onSubmit={e=>void send("CLOSE_ROUND",e,{roundId:r.id})} className="form-stack">
                <input name="reason" placeholder={tr("Closure and follow-up reference","سبب الإغلاق وإجراءات المتابعة")} required minLength={10} maxLength={1000}/>
                <button className="secondary-button" disabled={busy}>{tr("Close & archive","إغلاق وأرشفة")}</button>
              </form>}
    {editor==="close:"+r.id&&message&&<p role="alert" className="form-warning">{message}</p>}
  </CrudModal></>}
            <button className="secondary-button" type="button" onClick={()=>setSelectedRound(r.id)}>
              {tr("Select round","اختيار الجولة")}</button>
          </td>
        </tr>)}</tbody></table></div>
    </article>
    <article className="detail-card">
      <h2>{tr("5. Submitted evidence and independent provider assessment","5. أدلة التقديم وتقييم الجهة الخارجية المستقل")}</h2>
      <label>{tr("Review round","الجولة المراد مراجعتها")}<select value={selectedRound}
        onChange={e=>setSelectedRound(e.target.value)}>
        <option value="">{tr("Choose","اختر")}</option>
        {rounds.map(r=><option key={r.id} value={r.id}>{r.program.code} / {r.roundCode} [{r.status}]</option>)}
      </select></label>
      {currentRound&&<div className="table-wrap"><table><thead><tr>
        <th>{tr("Test/component","الفحص والمكوّن")}</th>
        <th>{tr("Exact submitted result","النتيجة المقدمة")}</th>
        <th>{tr("External feedback / verdict","تقييم الجهة الخارجية")}</th>
        <th>{tr("Action","إجراء")}</th>
      </tr></thead><tbody>{currentRound.observations.map(o=><tr key={o.id}>
        <td>{o.entryCode} / {o.componentCodeSnapshot}
          <small className="table-subtext">{locale==="ar"?o.componentNameArSnapshot||o.componentNameEnSnapshot:o.componentNameEnSnapshot}</small>
          <small className="table-subtext">{o.analyzerCodeSnapshot||"—"}</small></td>
        <td><strong>{o.observedValue} {o.unitSnapshot||""}</strong><small className="table-subtext">{o.methodSnapshot||"—"}</small></td>
        <td>{o.assessment||tr("Pending","قيد الانتظار")}
          {o.providerExpectedValue&&<small className="table-subtext">{tr("Expected","المتوقع")}: {o.providerExpectedValue}</small>}
          {o.providerFeedback&&<small className="table-subtext">{o.providerFeedback}</small>}</td>
        <td>{canEnter&&currentRound.status==="OPEN"&&<><button type="button" className="secondary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("remove:"+currentRound.id+":"+o.id);}}>
   {tr("Remove Draft EQA Observation","إزالة قراءة تقييم مسودة")}
  </button>
  <CrudModal open={editor==="remove:"+currentRound.id+":"+o.id} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Remove Draft EQA Observation","إزالة قراءة تقييم مسودة")}
    description={tr("Only open round draft readings can be removed with an audited reason.","يمكن إزالة قراءات المسودات للجولات المفتوحة فقط مع سبب مدقق.")}
    size="compact">
    {editor==="remove:"+currentRound.id+":"+o.id&&<form className="form-stack"
          onSubmit={e=>void send("REMOVE_OBSERVATION",e,{roundId:currentRound.id,observationId:o.id})}>
          <input name="reason" placeholder={tr("Removal reason","سبب الإزالة")} required minLength={10} maxLength={1000}/>
          <button className="secondary-button" disabled={busy}>{tr("Remove draft","حذف المسودة")}</button>
        </form>}
    {editor==="remove:"+currentRound.id+":"+o.id&&message&&<p role="alert" className="form-warning">{message}</p>}
  </CrudModal></>}
        {canResolve&&currentRound.status==="SUBMITTED"&&o.assessment===null&&
          currentRound.submittedByUserId!==actorId&&o.createdByUserId!==actorId&&
          (!currentRound.reviewedByUserId||currentRound.reviewedByUserId===actorId)&&
          <><button type="button" className="secondary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("assess:"+currentRound.id+":"+o.id);}}>
   {tr("Record Independent EQA Assessment","تسجيل تقييم خارجي مستقل")}
  </button>
  <CrudModal open={editor==="assess:"+currentRound.id+":"+o.id} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Record Independent EQA Assessment","تسجيل تقييم خارجي مستقل")}
    description={tr("Review external provider verdict, expected value and corrective follow-up; the submitting operator cannot self-review.","راجع حكم الجهة والقيمة المتوقعة والمتابعة التصحيحية؛ لا يجوز لمن أدخل القياس مراجعته بنفسه.")}
    size="compact">
    {editor==="assess:"+currentRound.id+":"+o.id&&<form className="form-stack" onSubmit={e=>void send("ASSESS_OBSERVATION",e,
            {roundId:currentRound.id,observationId:o.id})}>
            <select name="assessment" required defaultValue="">
              <option value="">{tr("Select provider verdict","اختر حكم الجهة")}</option>
              <option value="SATISFACTORY">{tr("Satisfactory","مُرضٍ")}</option>
              <option value="UNSATISFACTORY">{tr("Unsatisfactory","غير مُرضٍ")}</option>
              <option value="NOT_EVALUATED">{tr("Not evaluated","لم يُقيّم")}</option>
            </select>
            <input name="providerExpectedValue" maxLength={300} placeholder={tr("Provider expected result","القيمة المرجعية الخارجية")}/>
            <textarea name="providerFeedback" maxLength={1000} rows={2}
              placeholder={tr("Provider feedback / corrective follow-up","ملاحظات الجهة والمتابعة التصحيحية")}/>
            <input name="reason" minLength={10} maxLength={1000} required
              placeholder={tr("Review justification","مبرر المراجعة")}/>
            <button className="secondary-button" disabled={busy}>{tr("Record external assessment","تسجيل التقييم الخارجي")}</button>
          </form>}
    {editor==="assess:"+currentRound.id+":"+o.id&&message&&<p role="alert" className="form-warning">{message}</p>}
  </CrudModal></>}</td>
      </tr>)}</tbody></table></div>}
      <p className="muted">{tr(
        "Submitted measurements and finalized provider verdicts are immutable. EQA is documented separately from patient results; no automatic clinical release or QC blocking is applied.",
        "القياسات المقدمة وأحكام التقييم النهائية محفوظة بلا تعديل. أدلة EQA منفصلة عن نتائج المرضى ولا يؤدي ذلك إلى إفراج سريري تلقائي أو منع إصدار النتائج.",
      )}</p>
    </article>
    {canManage&&<article className="detail-card">
      <h2>{tr("6. Retire completed EQA program","6. إيقاف برنامج كفاءة مكتمل")}</h2>
      <button type="button" className="primary-button" disabled={busy}
   onClick={()=>{setMessage("");setEditor("retire");}}>
   {tr("Retire EQA Program","إيقاف برنامج تقييم خارجي")}
  </button>
  <CrudModal open={editor==="retire"} onClose={()=>{if(!busy)setEditor("");}}
    title={tr("Retire EQA Program","إيقاف برنامج تقييم خارجي")}
    description={tr("The server permits retirement only after all associated rounds are closed; a documented reason is required.","لا يسمح السيرفر بالإيقاف إلا بعد إغلاق كل الجولات؛ السبب الموثّق إلزامي.")}
    size="compact">
    {editor==="retire"&&<form className="form-stack" onSubmit={e=>void send("DEACTIVATE_PROGRAM",e)}>
        <select name="programId" required>
          <option value="">{tr("Choose program","اختر البرنامج")}</option>
          {programs.filter(p=>p.status==="ACTIVE").map(p=><option key={p.id} value={p.id}>
            {p.branch.code} / {p.code}</option>)}
        </select>
        <input name="reason" required minLength={10} maxLength={1000}
          placeholder={tr("Documented retirement reason","سبب الإيقاف الموثّق")}/>
        <button className="secondary-button" disabled={busy}>{tr("Retire if every round is closed","إيقاف إذا كانت جميع الجولات مغلقة")}</button>
      </form>}
  </CrudModal>
    </article>}
  </div>;
}
