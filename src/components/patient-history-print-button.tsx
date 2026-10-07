"use client";

export function PatientHistoryPrintButton({ locale }: { locale: "ar" | "en" }) {
  const label = locale === "ar" ? "طباعة السجل التراكمي" : "Print Cumulative History";
  return <button className="secondary-button no-print" type="button" onClick={() => window.print()}>
    {label}
  </button>;
}
