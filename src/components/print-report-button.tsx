"use client";

export function PrintReportButton() {
  return <button className="primary-button no-print" type="button" onClick={() => window.print()}>Print Report</button>;
}
