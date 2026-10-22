import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {projectF2EffectiveCatalogView,resolveF2EffectiveCatalogViews} from "@/lib/catalog-f2-effective-view";
import { OrderQuestionManager } from "@/components/order-question-manager";
import { SystemDateText } from "@/components/system-date-text";
import { ResultLayoutManager } from "@/components/result-layout-manager";
import { SpecialtyLayoutBatchEditor } from "@/components/specialty-layout-batch-editor";
import { LegacySpecialtyEvidenceReview } from "@/components/legacy-specialty-evidence-review";
import { ReferenceIntervalGovernanceActions } from "@/components/reference-interval-governance-actions";
import { TatPolicyGovernanceActions } from "@/components/tat-policy-governance-actions";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";
import { normalizeOrderQuestionOptions } from "@/lib/order-questions";

export const dynamic = "force-dynamic";

export default async function TestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.view");
  const { id } = await params;
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const test = await prisma.$transaction(async tx => {
    const asOf=new Date();
    const current=await tx.labTest.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      department: true, specimenType: true, container: true, method: true, defaultUnit: true,
      branchAvailability: { include: { branch: true } },
      components: { include: { unit: true, resultSection: true, referenceIntervals: { include: { branch: true, method: true, analyzer: true, specimenType: true, createdBy: true, approvedBy: true, retiredBy: true }, orderBy: { effectiveFrom: "desc" } } }, orderBy: { displayOrder: "asc" } },
      tatPolicies: { include: { branch: true, createdBy: true, approvedBy: true, retiredBy: true }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] },
      resultSections: { orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
      orderQuestions: { orderBy: [{ code: "asc" }, { version: "desc" }, { effectiveFrom: "desc" }] },
    },
    });
    if(!current)return null;
    const targets=[
      {entityType:"TEST" as const,id:current.id},
      ...current.components.map(component=>({
        entityType:"COMPONENT" as const,id:component.id,
      })),
      ...(current.container?[{entityType:"CONTAINER" as const,id:current.container.id}]:[]),
      ...(current.defaultUnit?[{entityType:"UNIT" as const,id:current.defaultUnit.id}]:[]),
      ...current.components.filter(component=>component.unit).map(component=>({
        entityType:"UNIT" as const,id:component.unit!.id,
      })),
    ];
    const unique=[...new Map(targets.map(item=>[
      item.entityType+":"+item.id,item,
    ])).values()];
    const overlays=await resolveF2EffectiveCatalogViews(tx,{
      organizationId:session.user.organizationId,asOf,records:unique,
    });
    return {
      ...projectF2EffectiveCatalogView("TEST",current,overlays),
      container:current.container?
        projectF2EffectiveCatalogView("CONTAINER",current.container,overlays):null,
      defaultUnit:current.defaultUnit?
        projectF2EffectiveCatalogView("UNIT",current.defaultUnit,overlays):null,
      components:current.components.map(component=>({
        ...projectF2EffectiveCatalogView("COMPONENT",component,overlays),
        unit:component.unit?
          projectF2EffectiveCatalogView("UNIT",component.unit,overlays):null,
      })).sort((a,b)=>a.displayOrder-b.displayOrder||a.code.localeCompare(b.code)),
    };
  },{isolationLevel:"RepeatableRead",timeout:30000});
  if (!test) notFound();

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const referenceApprovalLabel = (value: string) => ({
    DRAFT: tr(locale, "Draft", "مسودة"),
    APPROVED: tr(locale, "Approved", "معتمد"),
    RETIRED: tr(locale, "Retired", "موقوف"),
  }[value] || value);
  const actorName = (user: { displayNameEn: string; displayNameAr: string | null } | null) =>
    user ? (locale === "ar" ? user.displayNameAr || user.displayNameEn : user.displayNameEn) : "—";
  const resultTypeLabel = (value: string) => ({
    NUMERIC: tr(locale, "Numeric", "رقمي"),
    TEXT: tr(locale, "Text", "نصي"),
    QUALITATIVE: tr(locale, "Qualitative", "نوعي"),
    BOOLEAN: tr(locale, "Yes / No", "نعم / لا"),
    DATE: tr(locale, "Date", "تاريخ"),
  }[value] || value);
  const responseTypeLabel = (value: string) => ({
    TEXT: tr(locale, "Text", "نص"),
    NUMERIC: tr(locale, "Numeric", "رقمي"),
    BOOLEAN: tr(locale, "Yes / No", "نعم / لا"),
    DATE: tr(locale, "Date", "تاريخ"),
    DATETIME: tr(locale, "Date & time", "التاريخ والوقت"),
    SINGLE_CHOICE: tr(locale, "Single choice", "اختيار واحد"),
  }[value] || value);
  const sexLabel = (value: string) =>
    value === "MALE" ? tr(locale, "Male", "ذكر") :
    value === "FEMALE" ? tr(locale, "Female", "أنثى") :
    value === "ALL" || value === "ANY" ? tr(locale, "All", "الكل") : value;
  const ageUnitLabel = (value: string) =>
    value === "DAY" || value === "DAYS" ? tr(locale, "days", "أيام") :
    value === "WEEK" || value === "WEEKS" ? tr(locale, "weeks", "أسابيع") :
    value === "MONTH" || value === "MONTHS" ? tr(locale, "months", "أشهر") :
    value === "YEAR" || value === "YEARS" ? tr(locale, "years", "سنوات") : value.toLowerCase();
  const pregnancyLabel = (value: string | null) =>
    value === "PREGNANT" ? tr(locale, "Pregnant", "حامل") :
    value === "NOT_PREGNANT" ? tr(locale, "Not pregnant", "غير حامل") :
    tr(locale, "Any pregnancy context", "أي سياق حمل");

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Test Definition", "تعريف الفحص")}</p>
        <h1>{test.code} — {localizedName(test)}</h1>
        <p className="muted">{locale === "ar" ? test.nameEn : test.nameAr || tr(locale, "No Arabic name configured", "لا يوجد اسم عربي مهيأ")}</p>
      </div>
      <Link className="secondary-link" href="/catalog">{tr(locale, "Back to Test Catalog", "العودة إلى دليل الفحوصات")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Configuration", "الإعداد")}</h2>
        <dl>
          <dt>{tr(locale, "Department", "القسم")}</dt><dd>{test.department ? localizedName(test.department) : "—"}</dd>
          <dt>{tr(locale, "Specimen", "نوع العينة")}</dt><dd>{test.specimenType ? localizedName(test.specimenType) : "—"}</dd>
          <dt>{tr(locale, "Container", "الحاوية")}</dt><dd>{test.container ? localizedName(test.container) : "—"}</dd>
          <dt>{tr(locale, "Method", "الطريقة")}</dt><dd>{test.method ? localizedName(test.method) : "—"}</dd>
          <dt>{tr(locale, "Default unit", "الوحدة الافتراضية")}</dt><dd>{test.defaultUnit?.symbol || "—"}</dd>
          <dt>{tr(locale, "Result type", "نوع النتيجة")}</dt><dd>{resultTypeLabel(test.resultType)}</dd>
          <dt>{tr(locale, "Result layout", "تخطيط النتائج")}</dt><dd>{test.resultEntryLayout === "SECTIONED" ? tr(locale, "Sectioned", "مقسّم إلى أقسام") : test.resultEntryLayout === "COMPACT_GRID" ? tr(locale, "Compact grid", "شبكة مدمجة") : tr(locale, "Standard list", "قائمة قياسية")}</dd>
          <dt>TAT</dt><dd>{test.tatMinutes ? `${test.tatMinutes} ${tr(locale, "min", "دقيقة")}` : "—"}</dd>
          <dt>LOINC</dt><dd>{test.loincCode || "—"}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Branch Availability", "توفر الفحص حسب الفرع")}</h2>
        {test.branchAvailability.length ? test.branchAvailability.map(x =>
          <div className="availability-row" key={x.branchId}>
            <strong>{localizedName(x.branch)}</strong>
            <span>{statusLabel(locale, x.status)} · {x.performedHere ? tr(locale, "Performed here", "يُنفذ هنا") : tr(locale, "Send-out", "إرسال خارجي")}</span>
          </div>
        ) : <p className="muted">{tr(locale, "No branch availability configured.", "لم يتم إعداد توفر الفحص حسب الفروع.")}</p>}
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar">
        <h2>{tr(locale, "TAT / SLA Policies", "سياسات TAT / SLA")}</h2>
        <span>{test.tatPolicies.length} {tr(locale, "configured", "مهيأة")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Branch", "الفرع")}</th>
          <th>{tr(locale, "Priority", "الأولوية")}</th>
          <th>TAT</th>
          <th>{tr(locale, "Alert", "التنبيه")}</th>
          <th>{tr(locale, "Escalation", "التصعيد")}</th>
          <th>{tr(locale, "Effective", "السريان")}</th>
          <th>{tr(locale, "Governance", "الحوكمة")}</th>
          {permissions.has("catalog.tat_policies.approve") && <th>{tr(locale, "Action", "الإجراء")}</th>}
        </tr></thead>
        <tbody>{test.tatPolicies.length === 0 ? <tr><td colSpan={permissions.has("catalog.tat_policies.approve") ? 8 : 7} className="empty-state">{tr(locale, "No TAT / SLA policies configured. The catalog TAT remains the fallback.", "لا توجد سياسات TAT / SLA مهيأة. يبقى زمن الإنجاز الأساسي في دليل الفحص هو الخيار الاحتياطي.")}</td></tr> :
          test.tatPolicies.map(policy => <tr key={policy.id}>
            <td>{policy.branch ? localizedName(policy.branch) : tr(locale, "Organization default", "افتراضي المؤسسة")}</td>
            <td>{policy.priority === "STAT" ? "STAT" : policy.priority === "URGENT" ? tr(locale, "Urgent", "عاجل") : policy.priority === "ROUTINE" ? tr(locale, "Routine", "عادي") : tr(locale, "Any priority", "كل الأولويات")}</td>
            <td><strong>{policy.tatMinutes} {tr(locale, "min", "دقيقة")}</strong></td>
            <td>{policy.alertBeforeMinutes === null ? "—" : policy.alertBeforeMinutes + " " + tr(locale, "min before due", "دقيقة قبل الاستحقاق")}</td>
            <td>{policy.escalationAfterMinutes === null ? tr(locale, "Disabled", "معطل") : <>
              <strong>{policy.escalationAfterMinutes} {tr(locale, "min after due", "دقيقة بعد الاستحقاق")}</strong>
              <br/><small>{tr(locale, "Max level", "أقصى مستوى")}: {policy.maxEscalationLevel}{policy.escalationRepeatMinutes ? " · " + tr(locale, "repeat", "تكرار") + " " + policy.escalationRepeatMinutes + " " + tr(locale, "min", "دقيقة") : ""}</small>
              <br/><small>{tr(locale, "Recipients", "المستلمون")}: {policy.escalationPermissionCode || "—"}</small>
            </>}</td>
            <td><SystemDateText value={policy.effectiveFrom.toISOString().slice(0,10)} kind="calendar" />{" → "}{policy.effectiveTo ? <SystemDateText value={policy.effectiveTo.toISOString().slice(0,10)} kind="calendar" /> : tr(locale, "current", "حالي")}</td>
            <td>
              <strong>{referenceApprovalLabel(policy.approvalStatus)}</strong>
              <br/><small>{tr(locale, "Created by", "أُنشئ بواسطة")}: {actorName(policy.createdBy)}</small>
              {policy.approvedAt ? <><br/><small>{tr(locale, "Approved by", "اعتمد بواسطة")}: {actorName(policy.approvedBy)} · <SystemDateText value={policy.approvedAt.toISOString()} timeZone={policy.branch?.timezone} /></small></> : null}
              {policy.retiredAt ? <><br/><small>{tr(locale, "Retired by", "أُوقف بواسطة")}: {actorName(policy.retiredBy)} · <SystemDateText value={policy.retiredAt.toISOString()} timeZone={policy.branch?.timezone} /></small></> : null}
              {policy.retirementReason ? <><br/><small>{tr(locale, "Reason", "السبب")}: {policy.retirementReason}</small></> : null}
              <br/><small>{tr(locale, "Record", "السجل")}: {statusLabel(locale, policy.status)}</small>
            </td>
            {permissions.has("catalog.tat_policies.approve") && <td><TatPolicyGovernanceActions id={policy.id} approvalStatus={policy.approvalStatus} locale={locale} /></td>}
          </tr>)}
        </tbody>
      </table></div>
    </section>
    <section className="table-card detail-section">
      <div className="table-toolbar">
        <h2>{tr(locale, "Components & Reference Intervals", "المكونات والمديات المرجعية")}</h2>
        <span>{test.components.length} {tr(locale, "component(s)", "مكوّن")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Component", "المكوّن")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Unit", "الوحدة")}</th>
          <th>{tr(locale, "Reference interval", "المدى المرجعي")}</th>
          <th>{tr(locale, "Critical limits", "الحدود الحرجة")}</th>
          <th>{tr(locale, "Effective", "السريان")}</th>
          <th>{tr(locale, "Governance", "الحوكمة")}</th>
          {permissions.has("catalog.reference_ranges.approve") && <th>{tr(locale, "Action", "الإجراء")}</th>}
        </tr></thead>
        <tbody>
          {test.components.length===0 ? <tr><td colSpan={permissions.has("catalog.reference_ranges.approve") ? 8 : 7} className="empty-state">{tr(locale, "No components configured.", "لا توجد مكونات مهيأة.")}</td></tr> :
            test.components.flatMap(component => component.referenceIntervals.length ? component.referenceIntervals.map((range,index) =>
              <tr key={range.id}>
                <td>{index===0 ? <><strong>{component.code}</strong><br/>{localizedName(component)}</> : ""}</td>
                <td>{index===0 ? resultTypeLabel(component.resultType) : ""}</td>
                <td>{index===0 ? (component.unit?.symbol||"—") : ""}</td>
                 <td>
                   {(locale === "ar" ? range.normalTextAr || range.normalTextEn : range.normalTextEn) || [range.lowValue?.toString(),range.highValue?.toString()].filter(Boolean).join(" – ") || "—"}
                   {" · "}{sexLabel(range.sex)}
                   {range.ageUnit ? ` · ${range.ageFrom?.toString()||"0"}–${range.ageTo?.toString()||"∞"} ${ageUnitLabel(range.ageUnit)}` : ""}
                   {range.pregnancyStatus ? ` · ${pregnancyLabel(range.pregnancyStatus)}` : ""}
                   {range.gestationalAgeFromWeeks !== null || range.gestationalAgeToWeeks !== null ? ` · ${tr(locale, "GA", "عمر الحمل")} ${range.gestationalAgeFromWeeks?.toString()||"0"}–${range.gestationalAgeToWeeks?.toString()||"∞"} ${tr(locale, "weeks", "أسبوع")}` : ""}
                   {range.specimenType ? ` · ${tr(locale, "Specimen", "العينة")}: ${localizedName(range.specimenType)}` : ""}
                   {range.analyzer ? ` · ${tr(locale, "Analyzer", "الجهاز")}: ${range.analyzer.code}` : ""}
                   {range.method ? ` · ${tr(locale, "Method", "الطريقة")}: ${localizedName(range.method)}` : ""}
                   {range.branch ? ` · ${tr(locale, "Branch", "الفرع")}: ${localizedName(range.branch)}` : ""}
                   {range.populationCode ? ` · ${tr(locale, "Population", "المجموعة")}: ${range.populationCode}` : ""}
                 </td>
                <td>{[range.criticalLow?.toString(),range.criticalHigh?.toString()].filter(Boolean).join(" / ")||"—"}</td>
                <td><SystemDateText value={range.effectiveFrom.toISOString().slice(0,10)} kind="calendar" />{" → "}{range.effectiveTo ? <SystemDateText value={range.effectiveTo.toISOString().slice(0,10)} kind="calendar" /> : tr(locale, "current", "حالي")}</td>
                <td>
                  <strong>{referenceApprovalLabel(range.approvalStatus)}</strong>
                  {range.source ? <><br/><small>{tr(locale, "Source", "المصدر")}: {range.source}</small></> : null}
                  <br/><small>{tr(locale, "Created by", "أُنشئ بواسطة")}: {actorName(range.createdBy)}</small>
                  {range.approvedAt ? <><br/><small>{tr(locale, "Approved by", "اعتمد بواسطة")}: {actorName(range.approvedBy)} · <SystemDateText value={range.approvedAt.toISOString()} timeZone={range.branch?.timezone} /></small></> : null}
                  {range.retiredAt ? <><br/><small>{tr(locale, "Retired by", "أُوقف بواسطة")}: {actorName(range.retiredBy)} · <SystemDateText value={range.retiredAt.toISOString()} timeZone={range.branch?.timezone} /></small></> : null}
                  {range.retirementReason ? <><br/><small>{tr(locale, "Reason", "السبب")}: {range.retirementReason}</small></> : null}
                </td>
                {permissions.has("catalog.reference_ranges.approve") && <td><ReferenceIntervalGovernanceActions id={range.id} approvalStatus={range.approvalStatus} locale={locale} /></td>}
              </tr>
            ) : [<tr key={component.id}>
              <td><strong>{component.code}</strong><br/>{localizedName(component)}</td>
              <td>{resultTypeLabel(component.resultType)}</td>
              <td>{component.unit?.symbol||"—"}</td>
              <td>—</td><td>—</td><td>—</td><td>—</td>
              {permissions.has("catalog.reference_ranges.approve") && <td>—</td>}
            </tr>])}
        </tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Ask-at-Order Questions", "أسئلة تُطرح عند الطلب")}</h2><span>{test.orderQuestions.length} {tr(locale, "version(s)", "إصدار")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Order", "الترتيب")}</th>
          <th>{tr(locale, "Code / version", "الرمز / الإصدار")}</th>
          <th>{tr(locale, "Question", "السؤال")}</th>
          <th>{tr(locale, "Type", "النوع")}</th>
          <th>{tr(locale, "Required", "مطلوب")}</th>
          <th>{tr(locale, "Options", "الخيارات")}</th>
          <th>{tr(locale, "Effective", "السريان")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th>
        </tr></thead>
        <tbody>{test.orderQuestions.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No test-specific order questions configured.", "لا توجد أسئلة طلب خاصة بهذا الفحص.")}</td></tr> :
          test.orderQuestions.map(question => {
            const options = normalizeOrderQuestionOptions(question.options);
            return <tr key={question.id}>
              <td>{question.displayOrder}</td>
              <td><strong>{question.code}</strong><br/><small>v{question.version}</small></td>
              <td>{locale === "ar" ? question.questionAr || question.questionEn : question.questionEn}{locale !== "ar" && question.questionAr && <><br/><small dir="rtl">{question.questionAr}</small></>}</td>
              <td>{responseTypeLabel(question.responseType)}</td>
              <td>{question.required ? tr(locale, "Yes", "نعم") : tr(locale, "No", "لا")}</td>
              <td>{options.length ? options.map(option => locale === "ar" ? option.valueAr || option.valueEn : option.valueEn).join(" · ") : "—"}</td>
              <td><SystemDateText value={question.effectiveFrom.toISOString().slice(0,10)} kind="calendar" /> → {question.effectiveTo ? <SystemDateText value={question.effectiveTo.toISOString().slice(0,10)} kind="calendar" /> : tr(locale, "current", "حالي")}</td>
              <td>{statusLabel(locale, question.status)}</td>
            </tr>;
          })}
        </tbody>
      </table></div>
    </section>

    {permissions.has("catalog.manage") && <section className="detail-card detail-section">
      <h2>{tr(locale, "Result Entry Layout", "تخطيط إدخال النتائج")}</h2>
      <p className="muted">{tr(locale, "Configure how components are grouped and presented in the result workspace. This does not change the underlying result model.", "هيئ طريقة تجميع وعرض المكوّنات في مساحة النتائج دون تغيير نموذج تخزين النتائج.")}</p>
      <SpecialtyLayoutBatchEditor
        testId={test.id}
        locale={locale}
        layout={test.resultEntryLayout}
        sections={test.resultSections.map(section => ({
          id: section.id, code: section.code, nameEn: section.nameEn, nameAr: section.nameAr,
          displayOrder: section.displayOrder, columnCount: section.columnCount,
          hintEn: section.hintEn, hintAr: section.hintAr, status: section.status,
        }))}
        components={test.components.map(component => ({
          id: component.id, code: component.code, nameEn: component.nameEn,
          nameAr: component.nameAr, resultSectionId: component.resultSectionId,
          entryWidth: component.entryWidth, entryHintEn: component.entryHintEn,
          entryHintAr: component.entryHintAr, status: component.status,
        }))}
      />
      <ResultLayoutManager
        testId={test.id}
        layout={test.resultEntryLayout}
        sections={test.resultSections.map(section => ({
          id: section.id,
          code: section.code,
          nameEn: section.nameEn,
          nameAr: section.nameAr,
          displayOrder: section.displayOrder,
          reportDisplayOrder: section.reportDisplayOrder,
          reportVisible: section.reportVisible,
          columnCount: section.columnCount,
          hintEn: section.hintEn,
          hintAr: section.hintAr,
          status: section.status,
        }))}
        components={test.components.map(component => ({
          id: component.id,
          code: component.code,
          nameEn: component.nameEn,
          nameAr: component.nameAr,
          resultSectionId: component.resultSectionId,
          reportNameEn: component.reportNameEn,
          reportNameAr: component.reportNameAr,
          reportDisplayOrder: component.reportDisplayOrder,
          reportVisible: component.reportVisible,
          entryWidth: component.entryWidth,
          entryHintEn: component.entryHintEn,
          entryHintAr: component.entryHintAr,
        }))}
        locale={locale}
      />
    </section>}

    {permissions.has("catalog.manage") && <LegacySpecialtyEvidenceReview testId={test.id} locale={locale} />}

    {permissions.has("catalog.manage") && <section className="detail-card detail-section">
      <h2>{tr(locale, "Add / Revise Ask-at-Order Question", "إضافة / إصدار جديد لسؤال الطلب")}</h2>
      <p className="muted">{tr(locale, "Questions are effective-dated and versioned. Reusing a code creates a new version while historical orders keep their original question and answer snapshots.", "الأسئلة مؤرخة بالسريان ومقسمة إلى إصدارات. إعادة استخدام الرمز تنشئ إصدارًا جديدًا بينما تحتفظ الطلبات التاريخية بنسخة السؤال والإجابة الأصلية.")}</p>
      <OrderQuestionManager testId={test.id} locale={locale} />
    </section>}
  </main>;
}
