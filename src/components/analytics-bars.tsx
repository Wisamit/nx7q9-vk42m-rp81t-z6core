type BarItem = {
  label: string;
  value: number;
  displayValue?: string;
};

export function AnalyticsBars({
  title,
  items,
  emptyText = "No data for the selected period.",
}: {
  title: string;
  items: BarItem[];
  emptyText?: string;
}) {
  const max = Math.max(0, ...items.map(item => item.value));
  return <article className="detail-card">
    <h2>{title}</h2>
    {items.length === 0 ? <p className="muted">{emptyText}</p> : <div className="analytics-bars">
      {items.map(item => {
        const width = max > 0 ? Math.max(2, Math.round((item.value / max) * 100)) : 0;
        return <div className="analytics-bar-row" key={item.label}>
          <div className="analytics-bar-label"><span>{item.label}</span><strong>{item.displayValue ?? item.value.toLocaleString()}</strong></div>
          <div className="analytics-bar-track"><span style={{ width: width + "%" }} /></div>
        </div>;
      })}
    </div>}
  </article>;
}
