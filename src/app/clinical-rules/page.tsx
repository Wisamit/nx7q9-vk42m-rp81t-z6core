import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClinicalRulesManager } from "@/components/clinical-rules-manager";
import { AdvancedClinicalRulesManager } from "@/components/advanced-clinical-rules-manager";
import { AutoverificationValidationManager } from "@/components/autoverification-validation-manager";
import { CriticalEscalationManager } from "@/components/critical-escalation-manager";
import { QualitativeResultOptionsManager } from "@/components/qualitative-result-options-manager";
import { CommentTemplateStatusButton } from "@/components/comment-template-status-button";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ClinicalRulesPage() {
  const session = await requirePermission("clinical_rules.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";

  const [tests, branches, methods, deltaRules, commentTemplates, calculatedRules, reflexRules, autoverificationPolicies, validationHoldRules, criticalEscalationPolicies, qualitativeResultOptions] = await Promise.all([
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" }, orderBy: { displayOrder: "asc" } } },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.method.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
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
    prisma.criticalEscalationPolicy.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.qualitativeResultOption.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, component: true },
      orderBy: [{ testId: "asc" }, { componentId: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const openLabel = tr(locale, "Open", "مفتوح");
  const branchLabel = (branch: { code: string; nameEn: string; nameAr?: string | null } | null) =>
    branch ? `${branch.code} — ${localizedName(branch)}` : tr(locale, "All branches", "كل الفروع");
  const conditionLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      ALWAYS: ["Always hold", "إيقاف دائم"],
      RESULT_SOURCE: ["Result source", "مصدر النتيجة"],
      ANY_ABNORMAL: ["Any abnormal flag", "أي إشارة غير طبيعية"],
      ANY_CRITICAL: ["Any critical value", "أي قيمة حرجة"],
      DELTA_EXCEEDED: ["Delta limit exceeded", "تجاوز حد Delta"],
    };
    const label = labels[value];
    return label ? tr(locale, label[0], label[1]) : value;
  };
  const sourceLabel = (value: string | null) => {
    if (!value) return "";
    const labels: Record<string, [string, string]> = {
      MANUAL: ["Manual", "يدوي"],
      ANALYZER: ["Analyzer", "جهاز"],
      IMPORT: ["Import", "استيراد"],
      CALCULATED: ["Calculated", "محسوبة"],
    };
    const label = labels[value];
    return label ? tr(locale, label[0], label[1]) : value;
  };
  const severityLabel = (value: string) =>
    value === "BLOCK" ? tr(locale, "Block", "حظر") :
    value === "WARNING" ? tr(locale, "Warning", "تحذير") : value;
  const scopeLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      ORGANIZATION: ["Organization", "المؤسسة"],
      TEST: ["Test", "الفحص"],
      COMPONENT: ["Component", "المكوّن"],
    };
    const label = labels[value];
    return label ? tr(locale, label[0], label[1]) : value;
  };

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Advanced Clinical Rules", "القواعد السريرية المتقدمة")}</p>
        <h1>{tr(locale, "Clinical Rules", "القواعد السريرية")}</h1>
        <p className="muted">{tr(locale, "Calculated results, reflex recommendations, validation holds, autoverification, critical escalation, delta checks and reusable comments are configuration-driven and effective-dated.", "النتائج المحسوبة والتوصيات الانعكاسية وإيقافات التحقق والتحقق الآلي وتصعيد النتائج الحرجة وفحوصات Delta والتعليقات القابلة لإعادة الاستخدام كلها قابلة للتهيئة ومؤرخة بسريانها.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}</Link>
    </header>

    <ClinicalRulesManager
      locale={locale}
      tests={tests.map(test => ({
        id: test.id,
        code: test.code,
        nameEn: test.nameEn,
        nameAr: test.nameAr,
        methodId: test.methodId,
        components: test.components.map(component => ({ id: component.id, code: component.code, nameEn: component.nameEn, nameAr: component.nameAr })),
      }))}
      branches={branches}
      methods={methods}
    />

    <AdvancedClinicalRulesManager
      locale={locale}
      tests={tests.map(test => ({
        id: test.id,
        code: test.code,
        nameEn: test.nameEn,
        nameAr: test.nameAr,
        resultType: test.resultType,
        components: test.components.map(component => ({
          id: component.id,
          code: component.code,
          nameEn: component.nameEn,
          nameAr: component.nameAr,
          resultType: component.resultType,
        })),
      }))}
      branches={branches}
    />

    <QualitativeResultOptionsManager
      locale={locale}
      tests={tests.map(test => ({
        id: test.id,
        code: test.code,
        nameEn: test.nameEn,
        nameAr: test.nameAr,
        resultType: test.resultType,
        components: test.components.map(component => ({
          id: component.id,
          code: component.code,
          nameEn: component.nameEn,
          nameAr: component.nameAr,
          resultType: component.resultType,
        })),
      }))}
      options={qualitativeResultOptions.map(option => ({
        id: option.id,
        testId: option.testId,
        componentId: option.componentId,
        code: option.code,
        valueEn: option.valueEn,
        valueAr: option.valueAr,
        flag: option.flag,
        isAbnormal: option.isAbnormal,
        isCritical: option.isCritical,
        displayOrder: option.displayOrder,
        effectiveFrom: option.effectiveFrom.toISOString().slice(0,10),
        effectiveTo: option.effectiveTo?.toISOString().slice(0,10) || null,
        status: option.status,
        testCode: option.test.code,
        testNameEn: option.test.nameEn,
        testNameAr: option.test.nameAr,
        componentCode: option.component?.code || null,
        componentNameEn: option.component?.nameEn || null,
        componentNameAr: option.component?.nameAr || null,
      }))}
    />

    <AutoverificationValidationManager
      locale={locale}
      tests={tests.map(test => ({ id: test.id, code: test.code, nameEn: test.nameEn, nameAr: test.nameAr }))}
      branches={branches}
    />

    <CriticalEscalationManager
      locale={locale}
      tests={tests.map(test => ({ id: test.id, code: test.code, nameEn: test.nameEn, nameAr: test.nameAr }))}
      branches={branches}
    />

    <section className="detail-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Critical Escalation Policies", "سياسات تصعيد النتائج الحرجة")}</h2><span>{criticalEscalationPolicies.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Acknowledge", "الإقرار")}</th><th>{tr(locale, "Escalation interval", "فاصل التصعيد")}</th><th>{tr(locale, "Max level", "أقصى مستوى")}</th><th>{tr(locale, "Read-back", "إعادة القراءة")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{criticalEscalationPolicies.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No critical escalation policies configured.", "لا توجد سياسات تصعيد للنتائج الحرجة.")}</td></tr> : criticalEscalationPolicies.map(policy => <tr key={policy.id}>
          <td><strong>{policy.test.code}</strong><br/><small>{localizedName(policy.test)}</small></td>
          <td>{branchLabel(policy.branch)}</td>
          <td>{policy.acknowledgementMinutes} {tr(locale, "min", "دقيقة")}</td>
          <td>{policy.escalationIntervalMinutes} {tr(locale, "min", "دقيقة")}</td>
          <td>{policy.maxEscalationLevel}</td>
          <td>{policy.requireReadBack ? tr(locale, "Required", "مطلوبة") : tr(locale, "Optional", "اختيارية")}</td>
          <td>{policy.effectiveFrom.toISOString().slice(0,10)} → {policy.effectiveTo?.toISOString().slice(0,10) || openLabel}</td>
          <td>{statusLabel(locale, policy.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Autoverification Policies", "سياسات التحقق الآلي")}</h2><span>{autoverificationPolicies.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Enabled", "مفعلة")}</th><th>{tr(locale, "Sources", "المصادر")}</th><th>{tr(locale, "Extra gate", "شرط إضافي")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{autoverificationPolicies.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No autoverification policies configured.", "لا توجد سياسات تحقق آلي.")}</td></tr> : autoverificationPolicies.map(policy => <tr key={policy.id}>
            <td><strong>{policy.test.code}</strong><br/><small>{localizedName(policy.test)}</small></td>
            <td>{branchLabel(policy.branch)}</td>
            <td>{policy.enabled ? tr(locale, "YES", "نعم") : tr(locale, "NO", "لا")}</td>
            <td>{[
              policy.allowManual ? tr(locale, "Manual", "يدوي") : null,
              policy.allowAnalyzer ? tr(locale, "Analyzer", "جهاز") : null,
              policy.allowImport ? tr(locale, "Import", "استيراد") : null,
            ].filter(Boolean).join(", ") || tr(locale, "None", "لا شيء")}</td>
            <td>{policy.requireAllFlagsNormal ? tr(locale, "All flags normal", "كل الإشارات طبيعية") : tr(locale, "Mandatory safety gates only", "بوابات السلامة الإلزامية فقط")}</td>
            <td>{policy.effectiveFrom.toISOString().slice(0,10)} → {policy.effectiveTo?.toISOString().slice(0,10) || openLabel}</td>
            <td>{statusLabel(locale, policy.status)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Validation Hold Rules", "قواعد إيقاف التحقق")}</h2><span>{validationHoldRules.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Condition", "الشرط")}</th><th>{tr(locale, "Severity", "الشدة")}</th><th>{tr(locale, "Reason", "السبب")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{validationHoldRules.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No validation hold rules configured.", "لا توجد قواعد إيقاف تحقق.")}</td></tr> : validationHoldRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.test.code}</strong><br/><small>{localizedName(rule.test)}</small></td>
            <td>{branchLabel(rule.branch)}</td>
            <td>{conditionLabel(rule.condition)}{rule.resultSource ? " · " + sourceLabel(rule.resultSource) : ""}</td>
            <td>{severityLabel(rule.severity)}</td>
            <td>{locale === "ar" ? rule.reasonAr || rule.reasonEn : rule.reasonEn}{rule.reasonAr && locale !== "ar" ? <><br/><small dir="rtl">{rule.reasonAr}</small></> : null}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || openLabel}</td>
            <td>{statusLabel(locale, rule.status)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Calculated Result Rules", "قواعد النتائج المحسوبة")}</h2><span>{calculatedRules.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Target", "الهدف")}</th><th>{tr(locale, "Expression", "المعادلة")}</th><th>{tr(locale, "Precision", "الدقة")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{calculatedRules.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No calculated result rules configured.", "لا توجد قواعد نتائج محسوبة.")}</td></tr> : calculatedRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.test.code}</strong><br/><small>{localizedName(rule.test)}</small></td>
            <td>{rule.targetComponent.code} — {localizedName(rule.targetComponent)}</td>
            <td><code>{rule.expression}</code></td>
            <td>{rule.decimalPrecision ?? tr(locale, "Component default", "افتراضي المكوّن")}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || openLabel}</td>
            <td>{statusLabel(locale, rule.status)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Reflex Recommendation Rules", "قواعد التوصيات الانعكاسية")}</h2><span>{reflexRules.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Source", "المصدر")}</th><th>{tr(locale, "Condition", "الشرط")}</th><th>{tr(locale, "Recommended test", "الفحص الموصى به")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{reflexRules.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No reflex rules configured.", "لا توجد قواعد توصية انعكاسية.")}</td></tr> : reflexRules.map(rule => <tr key={rule.id}>
            <td><strong>{rule.sourceTest.code}</strong>{rule.sourceComponent ? <><br/><small>{rule.sourceComponent.code} — {localizedName(rule.sourceComponent)}</small></> : null}</td>
            <td>{rule.operator} {rule.numericThreshold?.toString() || rule.textThreshold || "—"}</td>
            <td>{rule.targetTest.code} — {localizedName(rule.targetTest)}</td>
            <td>{branchLabel(rule.branch)}</td>
            <td>{rule.effectiveFrom.toISOString().slice(0,10)} → {rule.effectiveTo?.toISOString().slice(0,10) || openLabel}</td>
            <td>{statusLabel(locale, rule.status)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Delta Rules", "قواعد Delta")}</h2><span>{deltaRules.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Component", "المكوّن")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Absolute", "المطلق")}</th><th>{tr(locale, "Percent", "النسبة")}</th><th>{tr(locale, "Lookback", "الرجوع للخلف")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
            <tbody>{deltaRules.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No delta rules configured.", "لا توجد قواعد Delta.")}</td></tr> : deltaRules.map(rule => <tr key={rule.id}>
              <td><strong>{rule.test.code}</strong><br/><small>{localizedName(rule.test)}</small></td>
              <td>{rule.component ? rule.component.code + " — " + localizedName(rule.component) : tr(locale, "Whole/simple test", "الفحص الكامل / البسيط")}</td>
              <td>{(rule.branch ? rule.branch.code : tr(locale, "All branches", "كل الفروع")) + " · " + (rule.method ? rule.method.code : tr(locale, "All methods", "كل الطرق"))}</td>
              <td>{rule.absoluteLimit?.toString() || "—"}</td>
              <td>{rule.percentLimit ? rule.percentLimit.toString() + "%" : "—"}</td>
              <td>{rule.lookbackDays} {tr(locale, "days", "يوم")}</td>
              <td>{rule.effectiveFrom.toISOString().slice(0,10) + " → " + (rule.effectiveTo?.toISOString().slice(0,10) || openLabel)}</td>
              <td>{statusLabel(locale, rule.status)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Comment Templates", "قوالب التعليقات")}</h2><span>{commentTemplates.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Target", "الهدف")}</th><th>{tr(locale, "Comment", "التعليق")}</th><th>{tr(locale, "Status", "الحالة")}</th><th></th></tr></thead>
            <tbody>{commentTemplates.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No comment templates configured.", "لا توجد قوالب تعليقات.")}</td></tr> : commentTemplates.map(template => <tr key={template.id}>
              <td><strong>{template.code}</strong></td>
              <td>{locale === "ar" ? template.nameAr || template.nameEn : template.nameEn}{template.nameAr && locale !== "ar" ? <><br/><small dir="rtl">{template.nameAr}</small></> : null}</td>
              <td>{scopeLabel(template.scope)}</td>
              <td>{template.component ? template.component.code + " — " + localizedName(template.component) : template.test ? template.test.code + " — " + localizedName(template.test) : tr(locale, "Organization", "المؤسسة")}</td>
              <td>{locale === "ar" ? template.textAr || template.textEn : template.textEn}</td>
              <td>{statusLabel(locale, template.status)}</td>
              <td><CommentTemplateStatusButton id={template.id} status={template.status} locale={locale} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>
    </section>
  </main>;
}
