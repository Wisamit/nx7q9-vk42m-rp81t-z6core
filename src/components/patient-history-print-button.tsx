"use client";

export function PatientHistoryPrintButton({ locale }: { locale: "ar" | "en" }) {
  const label = locale === "ar" ? "طباعة النتائج الظاهرة في هذه الصفحة فقط" : "Print results on this page only";
  return <button className="secondary-button no-print" type="button" onClick={() => window.print()}>
    {label}
  </button>;
}
