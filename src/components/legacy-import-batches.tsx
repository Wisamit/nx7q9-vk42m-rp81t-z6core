type Batch={id:string;sourceName:string;sourceType:string;status:string;rows:number;createdAt:string};
export function LegacyImportBatches({batches}:{batches:Batch[]}){
 return <section className="table-card import-card"><div className="table-toolbar"><div><h2>Legacy Catalog Migration</h2><span>Controlled staging from the cleaned Family Lab MDB. Nothing is written directly into the live catalog.</span></div><span className="status-pill">{batches.length} batch(es)</span></div>
 {batches.length===0?<div className="import-empty"><strong>Import staging is ready.</strong><p>The next step is to extract legacy master data into a validated batch, then review warnings before committing it to the catalog.</p></div>:<div className="table-wrap"><table><thead><tr><th>Source</th><th>Type</th><th>Rows</th><th>Status</th><th>Created</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td><strong>{b.sourceName}</strong></td><td>{b.sourceType}</td><td>{b.rows}</td><td>{b.status}</td><td>{b.createdAt.slice(0,10)}</td></tr>)}</tbody></table></div>}
 </section>
}
