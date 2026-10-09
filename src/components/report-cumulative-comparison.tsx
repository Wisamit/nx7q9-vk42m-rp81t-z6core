import Link from "next/link";
import type { CumulativeComparison, ReportReading } from "@/lib/report-cumulative";

type Locale = "ar" | "en";

function reference(reading: ReportReading, locale: Locale) {
  const text = locale === "ar"
    ? reading.referenceTextAr || reading.referenceTextEn
    : reading.referenceTextEn;
  return text || (reading.referenceLow !== null || reading.referenceHigh !== null
    ? (reading.referenceLow || "—") + " – " + (reading.referenceHigh || "—")
    : "—");
}

export function ReportCumulativeComparison({
  rows,
  locale,
  examinedReports,
  moreReportsAvailable,
}: {
  rows: CumulativeComparison[];
  locale: Locale;
  examinedReports: number;
  moreReportsAvailable: boolean;
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const name = (en: string, ar: string | null) => locale === "ar" ? ar || en : en;
  const why = (row: CumulativeComparison) =>
    row.reason === "IDENTITY_UNKNOWN"
      ? tr("Stable analyte identity unavailable", "هوية عنصر التحليل الثابتة غير متاحة")
      : row.reason === "METHOD_UNKNOWN"
        ? tr("Method not recorded: no safe comparison", "طريقة التحليل غير موثقة: لا توجد مقارنة آمنة")
        : tr("No matching reading in inspected authorized reports", "لا توجد قراءة مطابقة ضمن التقارير المصرّح بها التي تم فحصها");

  return <section className="table-card report-history no-print" dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="table-toolbar">
      <div>
        <h2>{tr("Previous Result Comparison", "مقارنة النتائج السابقة")}</h2>
        <span>{tr(
          "Informational view only. The signed report and its reference intervals are unchanged.",
          "عرض معلوماتي فقط، دون أي تعديل على التقرير المعتمد أو مجالاته المرجعية.",
        )}</span>
      </div>
      <span>{rows.length} {tr("component(s)", "عنصر")}</span>
    </div>
    <p className="muted">
      {tr("Inspected ", "تم فحص ")}{examinedReports}{tr(
        " earlier authorized report(s). Different tests, units, methods or analyzers are never combined.",
        " تقرير سابق ضمن الصلاحيات. لا يتم دمج تحاليل أو وحدات أو طرق أو أجهزة مختلفة.",
      )}
      {moreReportsAvailable && " " + tr(
        "Additional older records exist and were NOT included; this is not the complete patient history.",
        "هناك سجلات أقدم لم تُفحص؛ هذا العرض ليس التاريخ الكامل للمريض.",
      )}
    </p>
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>{tr("Test / component", "الفحص / العنصر")}</th>
          <th>{tr("Current released value", "النتيجة الحالية الصادرة")}</th>
          <th>{tr("Current reference / flag", "المرجع / الإشارة الحالية")}</th>
          <th>{tr("Previous comparable value", "آخر نتيجة سابقة قابلة للمقارنة")}</th>
          <th>{tr("Previous reference / flag", "المرجع / الإشارة السابقة")}</th>
          <th>{tr("Previous report", "التقرير السابق")}</th>
        </tr></thead>
        <tbody>{rows.length === 0
          ? <tr><td colSpan={6} className="empty-state">{tr(
            "No eligible current result components are available within your branch scope.",
            "لا توجد نتائج حالية مؤهلة ضمن صلاحيات الفرع.",
          )}</td></tr>
          : rows.map((row, index) => <tr key={row.current.orderId + ":" + row.current.componentId + ":" + index}>
            <td><strong>{name(row.current.testNameEn, row.current.testNameAr)}</strong>
              <small> · {name(row.current.componentNameEn, row.current.componentNameAr)}</small></td>
            <td><strong>{row.current.value}</strong>{row.current.unit ? " " + row.current.unit : ""}
              <small> · v{row.current.resultVersion}</small></td>
            <td>{reference(row.current, locale)} · {row.current.flag}</td>
            <td>{row.previous ? <><strong>{row.previous.value}</strong>{row.previous.unit ? " " + row.previous.unit : ""}</>
              : <span className="muted">{why(row)}</span>}</td>
            <td>{row.previous ? reference(row.previous, locale) + " · " + row.previous.flag : "—"}</td>
            <td>{row.previous ? <>
              <Link className="table-link" href={"/reports/" + row.previous.orderId}>{row.previous.accessionNumber}</Link>
              <small> · {row.previous.issuedAt.replace("T", " ").slice(0, 16)} · v{row.previous.resultVersion}</small>
            </> : "—"}</td>
          </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
