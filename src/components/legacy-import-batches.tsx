"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Batch={id:string;sourceName:string;sourceType:string;status:string;rows:number;createdAt:string};
export function LegacyImportBatches({batches}:{batches:Batch[]}){
 const router=useRouter(); const input=useRef<HTMLInputElement>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 async function stage(file:File){setBusy(true);setMessage("");try{const payload=JSON.parse(await file.text());const r=await fetch("/api/catalog/imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const body=await r.json();if(!r.ok)throw new Error(body.error||"Import validation failed.");setMessage(`Staged ${body.summary.total} rows: ${body.summary.VALID||0} valid, ${body.summary.WARNING||0} warnings, ${body.summary.ERROR||0} errors.`);router.refresh()}catch(e){setMessage(e instanceof Error?e.message:"Could not stage export.")}finally{setBusy(false);if(input.current)input.current.value=""}}
 return <section className="table-card import-card"><div className="table-toolbar"><div><h2>Legacy Catalog Migration</h2><span>Controlled staging from the cleaned Family Lab MDB. Nothing is written directly into the live catalog.</span></div><div className="import-actions"><input ref={input} hidden type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void stage(f)}}/><button className="secondary-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?"Validating…":"Stage MDB Export"}</button><span className="status-pill">{batches.length} batch(es)</span></div></div>
 {message&&<p className="import-message">{message}</p>}
 {batches.length===0?<div className="import-empty"><strong>Import staging is ready.</strong><p>Export the legacy master data, stage the JSON here, then review warnings before committing anything to the live catalog.</p></div>:<div className="table-wrap"><table><thead><tr><th>Source</th><th>Type</th><th>Rows</th><th>Status</th><th>Created</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td><strong>{b.sourceName}</strong></td><td>{b.sourceType}</td><td>{b.rows}</td><td>{b.status}</td><td>{b.createdAt.slice(0,10)}</td></tr>)}</tbody></table></div>}
 </section>
}
