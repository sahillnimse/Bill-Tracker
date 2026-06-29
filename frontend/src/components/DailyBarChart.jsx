/**
 * Renders a simple bar chart from a daily series. Bars colored by `color`,
 * with the most recent point highlighted if it's flagged as an anomaly.
 */
export default function DailyBarChart({ series = [], color = "#818cf8", highlightLast = false }) {
  if (!series.length) {
    return <div className="empty-state">No data yet — click "Sync now" to fetch.</div>;
  }
  const values = series.map((d) => d.value);
  const max = Math.max(...values, 1);

  return (
    <div className="chart-wrap">
      {series.map((d, i) => {
        const isLast = i === series.length - 1;
        const height = Math.max(Math.round((d.value / max) * 100), 2);
        return (
          <div
            key={d.date + i}
            className="cb"
            title={`${d.date}: $${d.value}`}
            style={{
              height: `${height}%`,
              background: isLast && highlightLast ? "var(--danger)" : color,
              opacity: isLast && highlightLast ? 1 : 0.72,
              animation: `bUp .5s var(--sp) ${(i * 0.02).toFixed(2)}s both`,
            }}
          />
        );
      })}
    </div>
  );
}
