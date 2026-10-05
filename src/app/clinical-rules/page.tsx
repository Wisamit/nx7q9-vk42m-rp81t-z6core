import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClinicalRulesManager } from "@/components/clinical-rules-manager";
import { AdvancedClinicalRulesManager } from "@/components/advanced-clinical-rules-manager";

export const dynamic = "force-dynamic";

export default async function ClinicalRulesPage() {
  const session = await requirePermission("clinical_rules.manage");

  const [tests, branches, methods, deltaRules, commentTemplates, calculatedRules, reflexRules] = await Promise.all([
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" }, orderBy: { displayOrder: "asc" } } },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.method.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.deltaRule.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, component: true, branch: true, method: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.resultCommentTemplate.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, component: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.calculatedResultRule.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, targetComponent: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.reflexRule.findMany({
      where: { organizationId: session.user.organizationId },
      include: { sourceTest: true, sourceComponent: true, targetTest: true, branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Advanced Clinical Rules</p>
        <h1>Clinical Rules</h1>
        <p className="muted">Calculated results, reflex recommendations, delta checks and reusable comments are configuration-driven and effective-dated.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <ClinicalRulesManager
      tests={tests.map(test => ({
        id: test.id,
        code: test.code,
        nameEn: test.nameEn,
        methodId: test.methodId,
        components: test.components.map(component => ({ id: component.id, code: component.code, nameEn: component.nameEn })),
      }))}
      branches={branches}
      methods={methods}
    />

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Delta Rules</h2><span>{deltaRules.length} shown</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Test</th><th>Component</th><th>Scope</th><th>Absolute</th><th>Percent</th><th>Lookback</th><th>Effective</th><th>Status</th></tr></thead>
            <tbody>{deltaRules.length === 0 ? <tr><td colSpan={8} className="empty-state">No delta rules configured.</td></tr> : deltaRules.map(rule => <tr key={rule.id}>
              <td><strong>{rule.test.code}</strong><br/><small>{rule.test.nameEn}</small></td>
              <td>{rule.component ? rule.component.code + " — " + rule.component.nameEn : "Whole/simple test"}</td>
              <td>{(rule.branch?.code || "All branches") + " · " + (rule.method?.code || "All methods")}</td>
              <td>{rule.absoluteLimit?.toString() || "—"}</td>
              <td>{rule.percentLimit ? rule.percentLimit.toString() + "%" : "—"}</td>
              <td>{rule.lookbackDays} days</td>
              <td>{rule.effectiveFrom.toISOString().slice(0,10) + " → " + (rule.effectiveTo?.toISOString().slice(0,10) || "Open")}</td>
              <td>{rule.status}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Comment Templates</h2><span>{commentTemplates.length} shown</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Scope</th><th>Target</th><th>Comment</th><th>Status</th></tr></thead>
            <tbody>{commentTemplates.length === 0 ? <tr><td colSpan={6} className="empty-state">No comment templates configured.</td></tr> : commentTemplates.map(template => <tr key={template.id}>
              <td><strong>{template.code}</strong></td>
              <td>{template.nameEn}{template.nameAr ? <><br/><small dir="rtl">{template.nameAr}</small></> : null}</td>
              <td>{template.scope}</td>
              <td>{template.component ? template.component.code + " — " + template.component.nameEn : template.test ? template.test.code + " — " + template.test.nameEn : "Organization"}</td>
              <td>{template.textEn}</td>
              <td>{template.status}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>
    </section>
  </main>;
}
