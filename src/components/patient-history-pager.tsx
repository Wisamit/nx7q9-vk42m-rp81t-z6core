import Link from "next/link";
import type { PatientHistorySection } from "@/lib/patient-history-pagination";

export function PatientHistoryPager({
  patientId, section, page, hasNext, locale,
}: {
  patientId: string;
  section: PatientHistorySection;
  page: number;
  hasNext: boolean;
  locale: "ar" | "en";
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const href = (number: number) =>
    "/patients/" + patientId + "/history?section=" + section + "&page=" + number;
  return <nav className="result-actions no-print" aria-label={tr("History pages", "صفحات السجل")}>
    {page > 1 && <Link className="secondary-link" rel="prev" href={href(page - 1)}>
      {tr("Previous page", "الصفحة السابقة")}
    </Link>}
    <span>{tr("Page", "الصفحة")} {page} · {tr("20 records per page", "20 سجلاً لكل صفحة")}</span>
    {hasNext && <Link className="secondary-link" rel="next" href={href(page + 1)}>
      {tr("Next page", "الصفحة التالية")}
    </Link>}
  </nav>;
}
