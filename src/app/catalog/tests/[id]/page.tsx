import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OrderQuestionManager } from "@/components/order-question-manager";

export const dynamic = "force-dynamic";

export default async function TestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.view");
  const { id } = await params;
  const permissions = permissionSet(session);
  const test = await prisma.labTest.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      department: true, specimenType: true, container: true, method: true, defaultUnit: true,
      branchAvailability: { include: { branch: true } },
      components: { include: { unit: true, referenceIntervals: { include: { branch: true, method: true }, orderBy: { effectiveFrom: "desc" } } }, orderBy: { displayOrder: "asc" } },
      orderQuestions: { where: { status: "ACTIVE" }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
    },
  });
  if (!test) notFound();

  return <main className="catalog-shell">
    <header className="page-header"><div><p className="eyebrow">Test Definition</p><h1>{test.code} — {test.nameEn}</h1><p className="muted">{test.nameAr || "No Arabic name configured"}</p></div><Link className="secondary-link" href="/catalog">Back to Test Catalog</Link></header>
    <section className="detail-grid">
      <article className="detail-card"><h2>Configuration</h2><dl><dt>Department</dt><dd>{test.department?.nameEn || "—"}</dd><dt>Specimen</dt><dd>{test.specimenType?.nameEn || "—"}</dd><dt>Container</dt><dd>{test.container?.nameEn || "—"}</dd><dt>Method</dt><dd>{test.method?.nameEn || "—"}</dd><dt>Default unit</dt><dd>{test.defaultUnit?.symbol || "—"}</dd><dt>Result type</dt><dd>{test.resultType}</dd><dt>TAT</dt><dd>{test.tatMinutes ? `${test.tatMinutes} min` : "—"}</dd><dt>LOINC</dt><dd>{test.loincCode || "—"}</dd></dl></article>
      <article className="detail-card"><h2>Branch Availability</h2>{test.branchAvailability.length ? test.branchAvailability.map(x=><div className="availability-row" key={x.branchId}><strong>{x.branch.nameEn}</strong><span>{x.status} · {x.performedHere ? "Performed here" : "Send-out"}</span></div>) : <p className="muted">No branch availability configured.</p>}</article>
    </section>
    <section className="table-card detail-section"><div className="table-toolbar"><h2>Components & Reference Intervals</h2><span>{test.components.length} component(s)</span></div><div className="table-wrap"><table><thead><tr><th>Component</th><th>Type</th><th>Unit</th><th>Reference interval</th><th>Critical limits</th><th>Effective</th></tr></thead><tbody>
      {test.components.length===0?<tr><td colSpan={6} className="empty-state">No components configured.</td></tr>:test.components.flatMap(component=>component.referenceIntervals.length?component.referenceIntervals.map((range,index)=><tr key={range.id}><td>{index===0?<><strong>{component.code}</strong><br/>{component.nameEn}</>:""}</td><td>{index===0?component.resultType:""}</td><td>{index===0?(component.unit?.symbol||"—"):""}</td><td>{range.normalTextEn || [range.lowValue?.toString(),range.highValue?.toString()].filter(Boolean).join(" – ") || "—"} · {range.sex}{range.ageUnit?` · ${range.ageFrom?.toString()||"0"}–${range.ageTo?.toString()||"∞"} ${range.ageUnit.toLowerCase()}`:""}</td><td>{[range.criticalLow?.toString(),range.criticalHigh?.toString()].filter(Boolean).join(" / ")||"—"}</td><td>{range.effectiveFrom.toISOString().slice(0,10)}{range.effectiveTo?` → ${range.effectiveTo.toISOString().slice(0,10)}`:" → current"}</td></tr>):[<tr key={component.id}><td><strong>{component.code}</strong><br/>{component.nameEn}</td><td>{component.resultType}</td><td>{component.unit?.symbol||"—"}</td><td>—</td><td>—</td><td>—</td></tr>])}
    </tbody></table></div></section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Ask-at-Order Questions</h2><span>{test.orderQuestions.length} active</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Order</th><th>Code</th><th>Question</th><th>Type</th><th>Required</th><th>Options</th></tr></thead>
        <tbody>{test.orderQuestions.length === 0 ? <tr><td colSpan={6} className="empty-state">No test-specific order questions configured.</td></tr> :
          test.orderQuestions.map(question => <tr key={question.id}>
            <td>{question.displayOrder}</td>
            <td><strong>{question.code}</strong></td>
            <td>{question.questionEn}{question.questionAr && <><br/><small dir="rtl">{question.questionAr}</small></>}</td>
            <td>{question.responseType}</td>
            <td>{question.required ? "Yes" : "No"}</td>
            <td>{Array.isArray(question.options) ? (question.options as string[]).join(" · ") : "—"}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    {permissions.has("catalog.manage") && <section className="detail-card detail-section">
      <h2>Add Ask-at-Order Question</h2>
      <p className="muted">Questions configured here appear automatically when this test is selected during order entry.</p>
      <OrderQuestionManager testId={test.id} />
    </section>}
  </main>;
}
