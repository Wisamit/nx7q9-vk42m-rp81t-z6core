"use client";

import Link from "next/link";
import { SystemDateText } from "@/components/system-date-text";
import { useMemo, useState } from "react";
import type { TrendSeries } from "@/lib/patient-history";

export function PatientResultTrends({
  series,
  locale,
  canViewOrders,
}: {
  series: TrendSeries[];
  locale: "ar" | "en";
  canViewOrders: boolean;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [selectedKey, setSelectedKey] = useState(series[0]?.key || "");
  const selected = useMemo(
    () => series.find(item => item.key === selectedKey) || series[0] || null,
    [selectedKey, series],
  );

  if (!selected) {
    return <section className="detail-card">
      <h2>{tr("Result Trends", "اتجاهات النتائج")}</h2>
      <p className="muted">{tr(
        "No numeric released results are available for trending.",
        "لا توجد نتائج رقمية صادرة متاحة لعرض الاتجاهات.",
      )}</p>
    </section>;
  }

  const values = selected.points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(Math.abs(max), 1);
  const paddedMin = min - spread * 0.08;
  const paddedMax = max + spread * 0.08;
  const chartWidth = 760;
  const chartHeight = 230;
  const left = 52;
  const right = 20;
  const top = 18;
  const bottom = 40;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const x = (index: number) =>
    selected.points.length <= 1
      ? left + plotWidth / 2
      : left + (index / (selected.points.length - 1)) * plotWidth;
  const y = (value: number) =>
    top + (1 - (value - paddedMin) / (paddedMax - paddedMin || 1)) * plotHeight;
  const polyline = selected.points.map((point, index) => x(index) + "," + y(point.value)).join(" ");
  const label = locale === "ar"
    ? selected.componentNameAr || selected.componentNameEn
    : selected.componentNameEn;
  const testLabel = locale === "ar"
    ? selected.testNameAr || selected.testNameEn
    : selected.testNameEn;

  return <section className="detail-card patient-trend-card">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Result Trends", "اتجاهات النتائج")}</h2>
        <span>{tr(
          "Only current released report results. Units, methods and analyzers remain separate.",
          "نتائج التقارير الصادرة الحالية فقط. الوحدات وطرق التحليل والأجهزة تُعرض بشكل منفصل.",
        )}</span>
      </div>
      <label className="history-series-select">
        <span>{tr("Analyte", "التحليل")}</span>
        <select value={selected.key} onChange={event => setSelectedKey(event.target.value)}>
          {series.map(item => {
            const itemTest = locale === "ar" ? item.testNameAr || item.testNameEn : item.testNameEn;
            const itemComponent = locale === "ar" ? item.componentNameAr || item.componentNameEn : item.componentNameEn;
            return <option key={item.key} value={item.key}>
              {itemTest} · {itemComponent}{item.unit ? " · " + item.unit : ""}{item.methodId ? " · " + tr("Method", "الطريقة") + " " + item.methodId.slice(0, 8) : " · " + tr("Method unknown", "الطريقة غير معروفة")}{item.analyzerCode ? " · " + item.analyzerCode : ""}
            </option>;
          })}
        </select>
      </label>
    </div>

    <div className="patient-trend-heading">
      <strong>{testLabel} · {label}</strong>
      <span>{selected.unit || tr("No unit", "بدون وحدة")} · {selected.points.length} {tr("point(s)", "نقطة")}{selected.analyzerCode ? " · " + selected.analyzerCode : ""}</span>
    </div>

    {!selected.comparable && <p className="muted">{tr("Method provenance is unknown; readings are shown individually and must not be compared as a trend.", "طريقة التحليل غير موثقة؛ تُعرض القراءات منفردة ولا يجوز اعتبارها اتجاهاً قابلاً للمقارنة.")}</p>}
    <div className="patient-trend-chart" role="img" aria-label={tr("Historical result trend chart", "مخطط اتجاه النتائج التاريخية")}>
      <svg viewBox={"0 0 " + chartWidth + " " + chartHeight} preserveAspectRatio="none">
        <line x1={left} y1={top} x2={left} y2={top + plotHeight} className="patient-trend-axis" />
        <line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="patient-trend-axis" />
        <text x={4} y={top + 5} className="patient-trend-label">{max.toLocaleString()}</text>
        <text x={4} y={top + plotHeight} className="patient-trend-label">{min.toLocaleString()}</text>
        {selected.comparable && selected.points.length > 1 && <polyline points={polyline} className="patient-trend-line" />}
        {selected.points.map((point, index) => <circle
          key={point.observedAt + ":" + point.accessionNumber}
          cx={x(index)}
          cy={y(point.value)}
          r="4"
          className="patient-trend-point"
        />)}
      </svg>
    </div>

    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>{tr("Date", "التاريخ")}</th>
          <th>{tr("Accession", "رقم الطلب")}</th>
          <th>{tr("Value", "القيمة")}</th>
          <th>{tr("Flag", "الإشارة")}</th>
          <th>{tr("Result version", "إصدار النتيجة")}</th>
        </tr></thead>
        <tbody>{[...selected.points].reverse().map(point => <tr key={point.observedAt + ":" + point.accessionNumber}>
          <td><SystemDateText value={point.observedAt} /></td>
          <td>{canViewOrders
            ? <Link className="table-link" href={"/orders/" + point.orderId}>{point.accessionNumber}</Link>
            : point.accessionNumber}</td>
          <td><strong>{point.valueText}</strong>{selected.unit ? " " + selected.unit : ""}</td>
          <td>{point.flag}</td>
          <td>v{point.resultVersion}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
