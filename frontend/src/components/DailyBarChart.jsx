import { useState } from "react";

/**
 * Renders a bar chart from a daily series, annotated server-side with
 * 7-day / 20-day SMA values and a signal: "spike" | "dip" | "crossover_up"
 * | "crossover_down" | "normal".
 *
 * Hovering a bar shows the date, the value, and how it compares to the
 * 20-day SMA baseline: a spiked day shows "+X%", a day below average shows
 * "-X%", and a normal day just shows the plain percent (e.g. "5%").
 *
 * Bar heights use a square-root scale rather than linear. This keeps small
 * everyday values visible even when one outlier day (e.g. a one-time
 * charge) is many times larger than the rest — with a plain linear scale,
 * a single big spike crushes every other bar down to a sliver.
 *
 * Zero-value days are styled distinctly (dim, flat, muted color) so that
 * a long stretch of no activity — e.g. viewing 90 days after a workload
 * stopped — reads clearly as "no spend" rather than looking like a
 * rendering glitch or a chart that ignored the selected date range.
 */
export default function DailyBarChart({ series = [], color = "#818cf8", highlightLast = false, bufferPct = 0.15 }) {
  const [hovered, setHovered] = useState(null);

  if (!series.length) {
    return <div className="empty-state">No data yet — click "Sync now" to fetch.</div>;
  }

  const values = series.map((d) => d.value);
  const max = Math.max(...values, 1);
  const scaledMax = Math.sqrt(max);

  // Last day with nonzero spend — used to surface a "no activity since" hint
  // when the tail of the visible range is all zeros.
  const lastActiveIdx = (() => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].value > 0) return i;
    }
    return -1;
  })();
  const trailingZeroRun = lastActiveIdx >= 0 ? series.length - 1 - lastActiveIdx : 0;

  const hexToRgba = (hex, alpha) => {
    if (!hex || !hex.startsWith("#")) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const barColor = (d, isLast) => {
    if (d.value === 0) return "var(--t3)"; // muted — explicitly "no spend", not a data gap
    if (isLast && highlightLast) return "var(--danger)";
    
    const avgSMA = (d.sma_short + d.sma_long) / 2;
    if (d.sma_short == null || d.sma_long == null || Number.isNaN(avgSMA)) {
      return color;
    }
    
    const upper = avgSMA * (1 + bufferPct);
    const lower = avgSMA * (1 - bufferPct);
    if (d.value > upper) return "var(--danger)"; // spending spike (rose-red)
    if (d.value < lower) return hexToRgba(color, 0.35); // spending dip (muted theme color)
    // Within buffer → normal range (solid theme color)
    return color;
  };

  const formatDate = (dateStr) => {
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) return dateStr;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const pctLabel = (d) => {
    if (d.pct_vs_sma_long == null) return null;
    const pct = d.pct_vs_sma_long;
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
    return `${sign}${Math.abs(pct)}%`;
  };

  const signalLabel = (d) => {
    if (d.value === 0) return "No spend this day";
    switch (d.signal) {
      case "spike":
        return "Spiked above 20d avg";
      case "dip":
        return "Below 20d avg";
      case "crossover_up":
        return "7d SMA crossed above 20d SMA";
      case "crossover_down":
        return "7d SMA crossed below 20d SMA";
      default:
        return "Within normal range";
    }
  };

  return (
    <div>
      <div className="chart-wrap" style={{ position: "relative", overflow: "visible" }}>
        {hovered && (
          <div
            className="cb-tooltip"
            style={{
              position: "absolute",
              bottom: "100%",
              left: `${hovered.leftPct}%`,
              transform: `translateX(${hovered.leftPct < 15 ? "0%" : hovered.leftPct > 85 ? "-100%" : "-50%"
                })`,
              marginBottom: 10,
              padding: "12px 16px",
              borderRadius: 10,
              background: "var(--bg-card, #1a1a2e)",
              border: "1px solid var(--border, #333)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              whiteSpace: "nowrap",
              zIndex: 50,
              pointerEvents: "none",
              fontSize: 13,
              minWidth: 160,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{formatDate(hovered.d.date)}</div>
            <div style={{ color: "var(--text-muted, #999)", marginBottom: 2 }}>${hovered.d.value.toFixed(2)}</div>
            {hovered.d.value > 0 && hovered.d.pct_vs_sma_long != null && (
              <div
                style={{
                  marginTop: 6,
                  fontWeight: 700,
                  fontSize: 14,
                  color:
                    hovered.d.signal === "spike" || hovered.d.signal === "crossover_up"
                      ? "var(--danger)"
                      : hovered.d.signal === "dip" || hovered.d.signal === "crossover_down"
                        ? "var(--teal)"
                        : "inherit",
                }}
              >
                {pctLabel(hovered.d)} vs 20d avg
              </div>
            )}
            <div style={{ marginTop: 4, color: "var(--text-muted, #999)", fontSize: 12 }}>
              {signalLabel(hovered.d)}
            </div>
          </div>
        )}

        {series.map((d, i) => {
          const isLast = i === series.length - 1;
          const isZero = d.value === 0;
          const scaledValue = Math.sqrt(Math.max(d.value, 0));
          // Zero days get a small fixed flat height instead of the normal
          // min-height floor, so they read as a deliberate baseline rather
          // than an unusually short bar of real spend.
          const height = isZero
            ? 3
            : Math.max(Math.round((scaledValue / scaledMax) * 100), 4);
          const leftPct = ((i + 0.5) / series.length) * 100;

          return (
            <div
              key={d.date + i}
              className="cb"
              onMouseEnter={() => setHovered({ d, leftPct })}
              onMouseLeave={() => setHovered(null)}
              style={{
                height: `${height}%`,
                background: barColor(d, isLast),
                opacity: isZero ? 0.35 : isLast && highlightLast ? 1 : 0.72,
                animation: `bUp .5s var(--sp) ${(i * 0.02).toFixed(2)}s both`,
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>

      {trailingZeroRun >= 5 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--t3)" }}>
          No spend since {formatDate(series[lastActiveIdx].date)} — {trailingZeroRun} day
          {trailingZeroRun === 1 ? "" : "s"} with no activity.
        </div>
      )}
    </div>
  );
}