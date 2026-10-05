import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClinicalRulesManager } from "@/components/clinical-rules-manager";
import { AdvancedClinicalRulesManager } from "@/components/advanced-clinical-rules-manager";
import { AutoverificationValidationManager } from "@/components/autoverification-validation-manager";

export const dynamic = "force-dynamic";

export default async function ClinicalRulesPage() {
  const session = await requirePermission("clinical_rules.manage");

  const [tests, branches, methods, deltaRules, commentTemplates, calculatedRules, reflexRules, autoverificationPolicies, validationHoldRules] = await Promise.all([
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
    prisma.autoverificationPolicy.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.validationHoldRule.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Advanced Clinical Rules</p>
        <h1>Clinical Rules</h1>
        <p className="muted">Calculated results, reflex recommendations, validation holds, autoverification, delta checks and reusable comments are configuration-driven and effective-dated.</p>
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

    <AdvancedClinicalRulesManager
      tests={tests.map(test => ({
        id: test.id,
        code: test.code,
        nameEn: test.nameEn,
        resultType: test.resultType,
        components: test.components.map(component => ({
          id: component.id,
          code: component.code,
          nameEn: component.nameEn,
          resultType: component.resultType,
        })),
      }))}
      branches={branches}
    />

    <AutoverificationValidationManager
      tests={tests.map(test => ({ id: test.id, code: test.code, nameEn: test.nameEn }))}
      branches={branches}
    />

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Autoverification Policies</h2><span>{autoverificationPolicies.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Test</th><th>Branch</th><th>Enabled</th><th>Sources</th><th>Extra gate</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{autoverificationPolicies.length === 0 ? <tr><td colSpan={7} className="empty-state">No autoverification policies configured.</td></tr> : autoverificationPolicies.map(policy => <tr key={policy.id}>
            <td><strong>{policy.test.code}</strong><br/><small>{policy.test.nameEn}</small></td>
            <td>{policy.branch?.nameEn || "All branches"}</td>
            <td>{policy.enabled ? "YES" : "NO"}</td>
            <td>{[
              policy.allowManual ? "Manual" : null,
              policy.allowAnalyzer ? "Analyzer" : null,
              policy.allowImport ? "Import" : null,
            ].filter(Boolean).join(", ") || "None"}</td>
            <td>{policy.requireAllFlagsNormal ? "All flags normal" : "Mandatory safety gates only"}</td>
            <td>{policy.effectiveFrom.toISOString().slice(0,10)} → {policy.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{policy.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Validation Hold Rules</h2><span>{validationHoldRules.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Test</th><th>Branch</th><th>Condition</th><th>Severity</th><th>Reason</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{validationHoldRules.length === 0 ? <tr><td colSpan={7} className="empty-state">No validation hold rules configured.</td></tr> : validationHoldRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.test.code}</strong><br/><small>{rule.test.nameEn}</small></td>
            <td>{rule.branch?.nameEn || "All branches"}</td>
            <td>{rule.condition}{rule.resultSource ? " · " + rule.resultSource : ""}</td>
            <td>{rule.severity}</td>
            <td>{rule.reasonEn}{rule.reasonAr ? <><br/><small dir="rtl">{rule.reasonAr}</small></> : null}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{rule.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Calculated Result Rules</h2><span>{calculatedRules.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Test</th><th>Target</th><th>Expression</th><th>Precision</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{calculatedRules.length === 0 ? <tr><td colSpan={6} className="empty-state">No calculated result rules configured.</td></tr> : calculatedRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.test.code}</strong><br/><small>{rule.test.nameEn}</small></td>
            <td>{rule.targetComponent.code} — {rule.targetComponent.nameEn}</td>
            <td><code>{rule.expression}</code></td>
            <td>{rule.decimalPrecision ?? "Component default"}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{rule.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Reflex Recommendation Rules</h2><span>{reflexRules.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Source</th><th>Condition</th><th>Recommended test</th><th>Branch</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{reflexRules.length === 0 ? <tr><td colSpan={6} className="empty-state">No reflex rules configured.</td></tr> : reflexRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.sourceTest.code}</strong>{rule.sourceComponent ? <><br/><small>{rule.sourceComponent.code} — {rule.sourceComponent.nameEn}</small></> : null}</td>
            <td>{rule.operator} {rule.numericThreshold?.toString() || rule.textThreshold || "—"}</td>
            <td>{rule.targetTest.code} — {rule.targetTest.nameEn}</td>
            <td>{rule.branch?.nameEn || "All branches"}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{rule.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

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
