import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OrderQuestionManager } from "@/components/order-question-manager";
import { ResultLayoutManager } from "@/components/result-layout-manager";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function TestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.view");
  const { id } = await params;
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const test = await prisma.labTest.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      department: true, specimenType: true, container: true, method: true, defaultUnit: true,
      branchAvailability: { include: { branch: true } },
      components: { include: { unit: true, resultSection: true, referenceIntervals: { include: { branch: true, method: true }, orderBy: { effectiveFrom: "desc" } } }, orderBy: { displayOrder: "asc" } },
      resultSections: { orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
      orderQuestions: { where: { status: "ACTIVE" }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
    },
  });
  if (!test) notFound();

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
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
    SINGLE_CHOICE: tr(locale, "Single choice", "اختيار واحد"),
  }[value] || value);
  const sexLabel = (value: string) =>
    value === "MALE" ? tr(locale, "Male", "ذكر") :
    value === "FEMALE" ? tr(locale, "Female", "أنثى") :
    value === "ALL" || value === "ANY" ? tr(locale, "All", "الكل") : value;
  const ageUnitLabel = (value: string) =>
    value === "DAY" || value === "DAYS" ? tr(locale, "days", "أيام") :
    value === "MONTH" || value === "MONTHS" ? tr(locale, "months", "أشهر") :
    value === "YEAR" || value === "YEARS" ? tr(locale, "years", "سنوات") : value.toLowerCase();

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
        <h2>{tr(locale, "Components & Reference Intervals", "المكونات والمديات المرجعية")}</h2>
        <span>{test.components.length} {tr(locale, "component(s)", "مكوّن")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Component", "المكوّن")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Unit", "الوحدة")}</th>
          <th>{tr(locale, "Reference interval", "المدى المرجعي")}</th><th>{tr(locale, "Critical limits", "الحدود الحرجة")}</th><th>{tr(locale, "Effective", "السريان")}</th>
        </tr></thead>
        <tbody>
          {test.components.length===0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No components configured.", "لا توجد مكونات مهيأة.")}</td></tr> :
            test.components.flatMap(component => component.referenceIntervals.length ? component.referenceIntervals.map((range,index) =>
              <tr key={range.id}>
                <td>{index===0 ? <><strong>{component.code}</strong><br/>{localizedName(component)}</> : ""}</td>
                <td>{index===0 ? resultTypeLabel(component.resultType) : ""}</td>
                <td>{index===0 ? (component.unit?.symbol||"—") : ""}</td>
                <td>{(locale === "ar" ? range.normalTextAr || range.normalTextEn : range.normalTextEn) || [range.lowValue?.toString(),range.highValue?.toString()].filter(Boolean).join(" – ") || "—"} · {sexLabel(range.sex)}{range.ageUnit ? ` · ${range.ageFrom?.toString()||"0"}–${range.ageTo?.toString()||"∞"} ${ageUnitLabel(range.ageUnit)}` : ""}</td>
                <td>{[range.criticalLow?.toString(),range.criticalHigh?.toString()].filter(Boolean).join(" / ")||"—"}</td>
                <td>{range.effectiveFrom.toISOString().slice(0,10)}{range.effectiveTo ? ` → ${range.effectiveTo.toISOString().slice(0,10)}` : ` → ${tr(locale, "current", "حالي")}`}</td>
              </tr>
            ) : [<tr key={component.id}>
              <td><strong>{component.code}</strong><br/>{localizedName(component)}</td><td>{resultTypeLabel(component.resultType)}</td><td>{component.unit?.symbol||"—"}</td><td>—</td><td>—</td><td>—</td>
            </tr>])}
        </tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Ask-at-Order Questions", "أسئلة تُطرح عند الطلب")}</h2><span>{test.orderQuestions.length} {tr(locale, "active", "نشط")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Order", "الترتيب")}</th><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Question", "السؤال")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Required", "مطلوب")}</th><th>{tr(locale, "Options", "الخيارات")}</th></tr></thead>
        <tbody>{test.orderQuestions.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No test-specific order questions configured.", "لا توجد أسئلة طلب خاصة بهذا الفحص.")}</td></tr> :
          test.orderQuestions.map(question => <tr key={question.id}>
            <td>{question.displayOrder}</td>
            <td><strong>{question.code}</strong></td>
            <td>{locale === "ar" ? question.questionAr || question.questionEn : question.questionEn}{locale !== "ar" && question.questionAr && <><br/><small dir="rtl">{question.questionAr}</small></>}</td>
            <td>{responseTypeLabel(question.responseType)}</td>
            <td>{question.required ? tr(locale, "Yes", "نعم") : tr(locale, "No", "لا")}</td>
            <td>{Array.isArray(question.options) ? (question.options as string[]).join(" · ") : "—"}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    {permissions.has("catalog.manage") && <section className="detail-card detail-section">
      <h2>{tr(locale, "Result Entry Layout", "تخطيط إدخال النتائج")}</h2>
      <p className="muted">{tr(locale, "Configure how components are grouped and presented in the result workspace. This does not change the underlying result model.", "هيئ طريقة تجميع وعرض المكوّنات في مساحة النتائج دون تغيير نموذج تخزين النتائج.")}</p>
      <ResultLayoutManager
        testId={test.id}
        layout={test.resultEntryLayout}
        sections={test.resultSections.map(section => ({
          id: section.id,
          code: section.code,
          nameEn: section.nameEn,
          nameAr: section.nameAr,
          displayOrder: section.displayOrder,
          status: section.status,
        }))}
        components={test.components.map(component => ({
          id: component.id,
          code: component.code,
          nameEn: component.nameEn,
          nameAr: component.nameAr,
          resultSectionId: component.resultSectionId,
        }))}
        locale={locale}
      />
    </section>}

    {permissions.has("catalog.manage") && <section className="detail-card detail-section">
      <h2>{tr(locale, "Add Ask-at-Order Question", "إضافة سؤال يُطرح عند الطلب")}</h2>
      <p className="muted">{tr(locale, "Questions configured here appear automatically when this test is selected during order entry.", "تظهر الأسئلة المهيأة هنا تلقائياً عند اختيار هذا الفحص أثناء إدخال الطلب.")}</p>
      <OrderQuestionManager testId={test.id} locale={locale} />
    </section>}
  </main>;
}
