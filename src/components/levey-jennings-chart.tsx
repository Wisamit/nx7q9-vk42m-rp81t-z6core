"use client";

type Point = {
  id: string;
  runAt: string;
  zScore: number;
  status: string;
};

export function LeveyJenningsChart({
  title,
  points,
  locale,
}: {
  title: string;
  points: Point[];
  locale: "ar" | "en";
}) {
  const width = 720;
  const height = 220;
  const padX = 42;
  const padY = 22;
  const minZ = -4;
  const maxZ = 4;
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const statusLabel = (value: string) =>
    value === "PASS" ? tr("Pass", "ناجح") :
    value === "WARN" ? tr("Warning", "تحذير") :
    value === "FAIL" ? tr("Fail", "فشل") :
    value;
  const ordered = [...points].sort((a, b) => a.runAt.localeCompare(b.runAt));
  const x = (index: number) => ordered.length <= 1
    ? width / 2
    : padX + index * ((width - padX * 2) / (ordered.length - 1));
  const y = (z: number) => padY + (maxZ - Math.max(minZ, Math.min(maxZ, z))) * ((height - padY * 2) / (maxZ - minZ));

  return <article className="detail-card">
    <h3>{title}</h3>
    {ordered.length === 0 ? <p className="muted">{tr("No QC results yet.", "لا توجد نتائج QC بعد.")}</p> : <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr("Levey-Jennings chart for ", "مخطط Levey-Jennings لـ ") + title} style={{ width: "100%", minHeight: 220 }}>
        {[-3,-2,-1,0,1,2,3].map(level => <g key={level}>
          <line x1={padX} x2={width - padX} y1={y(level)} y2={y(level)} stroke="currentColor" opacity={level === 0 ? 0.45 : Math.abs(level) === 3 ? 0.35 : 0.18} strokeDasharray={level === 0 ? undefined : "4 4"} />
          <text x={8} y={y(level) + 4} fontSize="11" fill="currentColor">{level > 0 ? "+" : ""}{level} SD</text>
        </g>)}
        {ordered.length > 1 && <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={ordered.map((point, index) => `${x(index)},${y(point.zScore)}`).join(" ")}
        />}
        {ordered.map((point, index) => <g key={point.id}>
          <circle cx={x(index)} cy={y(point.zScore)} r={point.status === "FAIL" ? 5 : 4} fill="currentColor" opacity={point.status === "PASS" ? 0.65 : 1} />
          <title>{point.runAt.replace("T"," ").slice(0,19)} · z={point.zScore.toFixed(2)} · {statusLabel(point.status)}</title>
        </g>)}
      </svg>
      <p className="muted">{tr("Latest", "أحدث")} {ordered.length} {tr("points · normalized as z-score against the target mean and SD.", "نقطة · مطبعة كـ z-score مقابل المتوسط المستهدف وSD.")}</p>
    </>}
  </article>;
}
