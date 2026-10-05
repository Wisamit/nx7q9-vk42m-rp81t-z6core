import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
export const dynamic="force-dynamic";
export default async function ImportBatchPage({params}:{params:Promise<{id:string}>}){
 const session=await requirePermission("catalog.view"); const {id}=await params;
 const batch=await prisma.catalogImportBatch.findFirst({where:{id,organizationId:session.user.organizationId},include:{rows:{orderBy:{rowNumber:"asc"},take:1000}}}); if(!batch)notFound();
 const counts=batch.rows.reduce((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a},{} as Record<string,number>);
 return <main className="catalog-shell"><header className="page-header"><div><p className="eyebrow">Legacy Migration Review</p><h1>{batch.sourceName}</h1><p className="muted">Source rows are preserved separately from normalized candidates. Resolve errors before live import.</p></div><Link className="secondary-link" href="/catalog">Back to Test Catalog</Link></header>
 <section className="catalog-stats"><article><strong>{batch.rows.length}</strong><span>Rows shown</span></article><article><strong>{counts.VALID||0}</strong><span>Valid</span></article><article><strong>{counts.WARNING||0}</strong><span>Warnings</span></article><article><strong>{counts.ERROR||0}</strong><span>Errors</span></article></section>
 <section className="table-card"><div className="table-toolbar"><h2>Validation Review</h2><span>Status: {batch.status}</span></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Entity</th><th>Legacy key</th><th>Status</th><th>Normalized candidate</th><th>Issues</th></tr></thead><tbody>{batch.rows.map(r=><tr key={r.id}><td>{r.rowNumber}</td><td>{r.entityType}</td><td>{r.legacyKey||"—"}</td><td><strong>{r.status}</strong></td><td><code className="json-preview">{JSON.stringify(r.normalizedData)}</code></td><td><code className="json-preview">{Array.isArray(r.validationIssues)&&r.validationIssues.length?JSON.stringify(r.validationIssues):"—"}</code></td></tr>)}</tbody></table></div></section></main>
}
