"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ResultEntryLayout = "STANDARD" | "SECTIONED" | "COMPACT_GRID";
type ResultSection = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  displayOrder: number;
  reportDisplayOrder: number | null;
  reportVisible: boolean;
  columnCount: number;
  hintEn: string | null;
  hintAr: string | null;
  status: "ACTIVE" | "INACTIVE";
};
type ComponentOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  resultSectionId: string | null;
  reportNameEn: string | null;
  reportNameAr: string | null;
  reportDisplayOrder: number | null;
  reportVisible: boolean;
  entryWidth: "AUTO" | "NARROW" | "STANDARD" | "WIDE" | "FULL";
  entryHintEn: string | null;
  entryHintAr: string | null;
};

export function ResultLayoutManager({
  testId,
  layout,
  sections,
  components,
  locale,
}: {
  testId: string;
  layout: ResultEntryLayout;
  sections: ResultSection[];
  components: ComponentOption[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [selectedLayout, setSelectedLayout] = useState<ResultEntryLayout>(layout);
  const [componentId, setComponentId] = useState(components[0]?.id || "");
  const [sectionId, setSectionId] = useState(components[0]?.resultSectionId || "");
  const [presentationSectionId, setPresentationSectionId] = useState(sections.find(section => section.status === "ACTIVE")?.id || sections[0]?.id || "");
  const initialPresentationSection = sections.find(section => section.id === (sections.find(item => item.status === "ACTIVE")?.id || sections[0]?.id));
  const [sectionColumnCount, setSectionColumnCount] = useState(initialPresentationSection?.columnCount || 3);
  const [sectionReportDisplayOrder, setSectionReportDisplayOrder] = useState<number | "">(initialPresentationSection?.reportDisplayOrder ?? "");
  const [sectionReportVisible, setSectionReportVisible] = useState(initialPresentationSection?.reportVisible ?? true);
  const [sectionHintEn, setSectionHintEn] = useState(initialPresentationSection?.hintEn || "");
  const [sectionHintAr, setSectionHintAr] = useState(initialPresentationSection?.hintAr || "");
  const [presentationComponentId, setPresentationComponentId] = useState(components[0]?.id || "");
  const [reportNameEn, setReportNameEn] = useState(components[0]?.reportNameEn || "");
  const [reportNameAr, setReportNameAr] = useState(components[0]?.reportNameAr || "");
  const [reportDisplayOrder, setReportDisplayOrder] = useState<number | "">(components[0]?.reportDisplayOrder ?? "");
  const [reportVisible, setReportVisible] = useState(components[0]?.reportVisible ?? true);
  const [entryWidth, setEntryWidth] = useState<ComponentOption["entryWidth"]>(components[0]?.entryWidth || "AUTO");
  const [entryHintEn, setEntryHintEn] = useState(components[0]?.entryHintEn || "");
  const [entryHintAr, setEntryHintAr] = useState(components[0]?.entryHintAr || "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const activeSections = useMemo(
    () => sections.filter(section => section.status === "ACTIVE").sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code)),
    [sections],
  );

  const layoutLabel = (value: ResultEntryLayout) => ({
    STANDARD: tr("Standard list", "قائمة قياسية"),
    SECTIONED: tr("Sectioned", "مقسّم إلى أقسام"),
    COMPACT_GRID: tr("Compact grid", "شبكة مدمجة"),
  }[value]);

  async function post(action: string, data: Record<string, unknown>) {
    setBusy(action);
    setMessage("");
    const response = await fetch("/api/catalog/result-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, testId, ...data }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setBusy("");
    if (!response.ok) {
      setMessage(body.error || tr("Could not save result layout configuration.", "تعذر حفظ إعدادات تخطيط النتائج."));
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveLayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await post("SET_LAYOUT", { layout: selectedLayout })) {
      setMessage(tr("Result entry layout updated.", "تم تحديث تخطيط إدخال النتائج."));
    }
  }

  async function createSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (await post("CREATE_SECTION", data)) {
      form.reset();
      setMessage(tr("Result section created.", "تم إنشاء قسم النتائج."));
    }
  }

  async function assignComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await post("ASSIGN_COMPONENT", { componentId, sectionId })) {
      setMessage(tr("Component section updated.", "تم تحديث قسم المكوّن."));
    }
  }

  async function updateSectionPresentation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!presentationSectionId) return;
    if (await post("UPDATE_SECTION_PRESENTATION", {
      sectionId: presentationSectionId,
      columnCount: sectionColumnCount,
      reportDisplayOrder: sectionReportDisplayOrder,
      reportVisible: sectionReportVisible,
      hintEn: sectionHintEn,
      hintAr: sectionHintAr,
    })) {
      setMessage(tr("Section presentation updated.", "تم تحديث عرض القسم."));
    }
  }

  async function updateComponentPresentation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!presentationComponentId) return;
    if (await post("UPDATE_COMPONENT_PRESENTATION", {
      componentId: presentationComponentId,
      entryWidth,
      reportNameEn,
      reportNameAr,
      reportDisplayOrder,
      reportVisible,
      entryHintEn,
      entryHintAr,
    })) {
      setMessage(tr("Component presentation updated.", "تم تحديث عرض المكوّن."));
    }
  }

  async function setSectionStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    if (status === "INACTIVE" && !confirm(tr(
      "Deactivate this section? Components remain linked and will appear as ungrouped until the section is reactivated or reassigned.",
      "تعطيل هذا القسم؟ ستبقى المكوّنات مرتبطة به وستظهر بدون تجميع إلى أن يُعاد تفعيل القسم أو نقلها إلى قسم آخر.",
    ))) return;

    if (await post("SET_SECTION_STATUS", { sectionId: id, status })) {
      setMessage(status === "ACTIVE"
        ? tr("Section reactivated.", "تمت إعادة تفعيل القسم.")
        : tr("Section deactivated.", "تم تعطيل القسم."));
    }
  }

  return <div className="result-layout-manager">
    <div className="detail-grid">
      <article className="detail-card">
        <h3>{tr("Workspace Layout", "تخطيط مساحة النتائج")}</h3>
        <p className="muted">{tr(
          "Choose how this test's components are arranged during result entry. This changes presentation only; result storage and clinical rules remain generic.",
          "اختر طريقة ترتيب مكوّنات هذا الفحص أثناء إدخال النتائج. هذا يغيّر العرض فقط؛ تخزين النتائج والقواعد السريرية تبقى عامة.",
        )}</p>
        <form className="catalog-form" onSubmit={saveLayout}>
          <label>{tr("Layout", "التخطيط")}<select value={selectedLayout} onChange={event => setSelectedLayout(event.target.value as ResultEntryLayout)}>
            <option value="STANDARD">{layoutLabel("STANDARD")}</option>
            <option value="SECTIONED">{layoutLabel("SECTIONED")}</option>
            <option value="COMPACT_GRID">{layoutLabel("COMPACT_GRID")}</option>
          </select></label>
          <button className="primary-button" disabled={busy !== ""}>{busy === "SET_LAYOUT" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Layout", "حفظ التخطيط")}</button>
        </form>
      </article>

      <article className="detail-card">
        <h3>{tr("Create Result Section", "إنشاء قسم نتائج")}</h3>
        <p className="muted">{tr(
          "Sections are reusable presentation groups inside this test, such as Differential or Microscopy. Names are configuration, not hard-coded test logic.",
          "الأقسام هي مجموعات عرض داخل الفحص مثل Differential أو Microscopy، وأسماؤها إعدادات وليست منطقًا ثابتًا داخل النظام.",
        )}</p>
        <form className="catalog-form" onSubmit={createSection}>
          <label>{tr("Section code", "رمز القسم")}<input name="code" required placeholder={tr("e.g. MICROSCOPY", "مثال: MICROSCOPY")} /></label>
          <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Display order", "ترتيب العرض")}<input name="displayOrder" type="number" min="0" max="10000" defaultValue="0" /></label>
          <label>{tr("Grid columns", "أعمدة الشبكة")}<select name="columnCount" defaultValue="3">
            <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
          </select></label>
          <label className="form-span">{tr("Section hint (English)", "تعليمات القسم بالإنجليزية")}<input name="hintEn" maxLength={500} /></label>
          <label className="form-span">{tr("Section hint (Arabic)", "تعليمات القسم بالعربية")}<input name="hintAr" dir="rtl" maxLength={500} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "CREATE_SECTION" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Section", "إنشاء القسم")}</button>
        </form>
      </article>
    </div>

    {sections.length > 0 && <article className="detail-card">
      <h3>{tr("Section Presentation", "عرض القسم")}</h3>
      <p className="muted">{tr("Choose the compact-grid density and optional instructions for each configured section.", "حدد كثافة الشبكة المدمجة وتعليمات اختيارية لكل قسم مهيأ.")}</p>
      <form className="catalog-form" onSubmit={updateSectionPresentation}>
        <label>{tr("Section", "القسم")}<select value={presentationSectionId} onChange={event => {
          const id = event.target.value;
          setPresentationSectionId(id);
          const selected = sections.find(section => section.id === id);
          setSectionColumnCount(selected?.columnCount || 3);
          setSectionReportDisplayOrder(selected?.reportDisplayOrder ?? "");
          setSectionReportVisible(selected?.reportVisible ?? true);
          setSectionHintEn(selected?.hintEn || "");
          setSectionHintAr(selected?.hintAr || "");
        }}>
          {sections.map(section => <option key={section.id} value={section.id}>{section.code} — {localizedName(section)}</option>)}
        </select></label>
        <label>{tr("Grid columns", "أعمدة الشبكة")}<select value={sectionColumnCount} onChange={event => setSectionColumnCount(Number(event.target.value))}>
          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
        </select></label>
        <label className="form-span">{tr("English hint", "التعليمات بالإنجليزية")}<input value={sectionHintEn} onChange={event => setSectionHintEn(event.target.value)} maxLength={500} /></label>
        <label className="form-span">{tr("Arabic hint", "التعليمات بالعربية")}<input dir="rtl" value={sectionHintAr} onChange={event => setSectionHintAr(event.target.value)} maxLength={500} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "UPDATE_SECTION_PRESENTATION" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Section Presentation", "حفظ عرض القسم")}</button>
      </form>
    </article>}

    {components.length > 0 && <article className="detail-card">
      <h3>{tr("Component Presentation", "عرض المكوّن")}</h3>
      <p className="muted">{tr("Control entry guidance separately from report presentation. Report names, visibility, section and order are snapshotted with each new result so later catalog edits cannot rewrite released history.", "تحكم بتعليمات الإدخال بشكل مستقل عن عرض التقرير. تُحفظ أسماء التقرير وحالة الظهور والقسم والترتيب كلقطة مع كل نتيجة جديدة حتى لا تعيد تعديلات الدليل لاحقاً كتابة السجل الصادر.")}</p>
      <form className="catalog-form" onSubmit={updateComponentPresentation}>
        <label>{tr("Component", "المكوّن")}<select value={presentationComponentId} onChange={event => {
          const id = event.target.value;
          setPresentationComponentId(id);
          const selected = components.find(component => component.id === id);
          setReportNameEn(selected?.reportNameEn || "");
          setReportNameAr(selected?.reportNameAr || "");
          setReportDisplayOrder(selected?.reportDisplayOrder ?? "");
          setReportVisible(selected?.reportVisible ?? true);
          setEntryWidth(selected?.entryWidth || "AUTO");
          setEntryHintEn(selected?.entryHintEn || "");
          setEntryHintAr(selected?.entryHintAr || "");
        }}>
          {components.map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label>{tr("Field width", "عرض الحقل")}<select value={entryWidth} onChange={event => setEntryWidth(event.target.value as ComponentOption["entryWidth"])}>
          <option value="AUTO">{tr("Automatic", "تلقائي")}</option>
          <option value="NARROW">{tr("Narrow", "ضيق")}</option>
          <option value="STANDARD">{tr("Standard", "قياسي")}</option>
          <option value="WIDE">{tr("Wide", "عريض")}</option>
          <option value="FULL">{tr("Full row", "صف كامل")}</option>
        </select></label>
        <label className="form-span">{tr("English entry hint", "تعليمات الإدخال بالإنجليزية")}<input value={entryHintEn} onChange={event => setEntryHintEn(event.target.value)} maxLength={500} /></label>
        <label className="form-span">{tr("Arabic entry hint", "تعليمات الإدخال بالعربية")}<input dir="rtl" value={entryHintAr} onChange={event => setEntryHintAr(event.target.value)} maxLength={500} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "UPDATE_COMPONENT_PRESENTATION" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Component Presentation", "حفظ عرض المكوّن")}</button>
      </form>
    </article>}

    {components.length > 0 && <article className="detail-card">
      <h3>{tr("Assign Components to Sections", "ربط المكوّنات بالأقسام")}</h3>
      <form className="catalog-form result-layout-assignment" onSubmit={assignComponent}>
        <label>{tr("Component", "المكوّن")}<select value={componentId} onChange={event => {
          const nextId = event.target.value;
          setComponentId(nextId);
          setSectionId(components.find(component => component.id === nextId)?.resultSectionId || "");
        }}>
          {components.map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label>{tr("Section", "القسم")}<select value={sectionId} onChange={event => setSectionId(event.target.value)}>
          <option value="">{tr("Ungrouped", "بدون قسم")}</option>
          {activeSections.map(section => <option key={section.id} value={section.id}>{section.code} — {localizedName(section)}</option>)}
        </select></label>
        <button className="secondary-button" disabled={busy !== ""}>{busy === "ASSIGN_COMPONENT" ? tr("Saving…", "جارٍ الحفظ…") : tr("Assign", "ربط")}</button>
      </form>
    </article>}

    <article className="table-card">
      <div className="table-toolbar">
        <h3>{tr("Configured Sections", "الأقسام المهيأة")}</h3>
        <span>{sections.length} {tr("section(s)", "قسم")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Order", "الترتيب")}</th>
          <th>{tr("Code", "الرمز")}</th>
          <th>{tr("Name", "الاسم")}</th>
          <th>{tr("Components", "المكوّنات")}</th>
          <th>{tr("Grid", "الشبكة")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th></th>
        </tr></thead>
        <tbody>{sections.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No result sections configured.", "لا توجد أقسام نتائج مهيأة.")}</td></tr> :
          sections.map(section => <tr key={section.id}>
            <td>{section.displayOrder}</td>
            <td><strong>{section.code}</strong></td>
            <td>{localizedName(section)}{locale !== "ar" && section.nameAr ? <><br/><small dir="rtl">{section.nameAr}</small></> : null}</td>
            <td>{components.filter(component => component.resultSectionId === section.id).map(component => component.code).join(", ") || "—"}</td>
            <td>{section.columnCount} {tr("col", "عمود")}{(locale === "ar" ? section.hintAr || section.hintEn : section.hintEn) ? <><br/><small>{locale === "ar" ? section.hintAr || section.hintEn : section.hintEn}</small></> : null}</td>
            <td>{section.status === "ACTIVE" ? tr("Active", "نشط") : tr("Inactive", "غير نشط")}</td>
            <td><button
              type="button"
              className="secondary-button"
              disabled={busy !== ""}
              onClick={() => void setSectionStatus(section.id, section.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
            >
              {section.status === "ACTIVE" ? tr("Deactivate", "تعطيل") : tr("Reactivate", "إعادة تفعيل")}
            </button></td>
          </tr>)}
        </tbody>
      </table></div>
    </article>

    {message && <div className="form-success">{message}</div>}
  </div>;
}
