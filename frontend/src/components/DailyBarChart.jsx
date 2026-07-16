import { useState } from "react";
import { useCurrency } from "../context/CurrencyContext";

/**
 * Renders a bar chart from a daily series.
 *
 * Tier classification is computed entirely client-side from the visible
 * series itself: average = mean of all values in `series`, and each day
 * is classified by its % deviation from that average:
 *   - high   (> +threshold%)  -> tall bar, red message on hover
 *   - low    (< -threshold%)  -> short bar, green message on hover
 *   - average (within threshold%) -> normal bar, white message on hover
 *
 * This does NOT depend on d.signal or any backend threshold field at all,
 * so height, color, and message are always in agreement by construction.
 *
 * All displayed amounts (tooltip value + % vs avg) go through the shared
 * useCurrency().fmt(), so the tooltip always matches whatever currency
 * (USD/INR) is currently toggled — no hardcoded "$" anywhere.
 *
 * Zero-value days are styled distinctly (dim, flat, muted color) so a
 * long stretch of no activity reads clearly as "no spend."
 */
export default function DailyBarChart({ series = [], color = "#818cf8", highlightLast = false, tierThresholdPct = 15, formatter }) {
  const [hovered, setHovered] = useState(null);
  const { fmt: defaultFmt } = useCurrency();
  const fmt = formatter || defaultFmt;

  if (!series.length) {
    return <div className="empty-state">No data yet — click "Sync now" to fetch.</div>;
  }

  // Average computed only from days with actual spend (ignore zero days
  // so a long idle stretch doesn't drag the baseline down to near-zero).
  const activeValues = series.map((d) => d.value).filter((v) => v > 0);
  const average = activeValues.length
    ? activeValues.reduce((sum, v) => sum + v, 0) / activeValues.length
    : 0;

  const lastActiveIdx = (() => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].value > 0) return i;
    }
    return -1;
  })();
  const trailingZeroRun = lastActiveIdx >= 0 ? series.length - 1 - lastActiveIdx : 0;

  const formatDate = (dateStr) => {
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) return dateStr;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // % deviation from the locally-computed average. This is the single
  // source of truth for tier, height, color, and label text.
  const pctVsAvg = (d) => {
    if (average === 0) return 0;
    return ((d.value - average) / average) * 100;
  };

  const tierOf = (d) => {
    if (d.value === 0) return "zero";
    const pct = pctVsAvg(d);
    if (pct > tierThresholdPct) return "high";
    if (pct < -tierThresholdPct) return "low";
    return "average";
  };

  const pctLabel = (d) => {
    const pct = Math.round(pctVsAvg(d));
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
    return `${sign}${Math.abs(pct)}%`;
  };

  const signalLabel = (d) => {
    const tier = tierOf(d);
    switch (tier) {
      case "zero":
        return "No spend this day";
      case "high":
        return "Above average spend";
      case "low":
        return "Below average spend";
      default:
        return "Around average spend";
    }
  };

  const tierColor = (tier) => {
    switch (tier) {
      case "high":
        return "var(--danger)";
      case "low":
        return "var(--ok)";
      case "zero":
        return "var(--t3)";
      default:
        return "var(--t1)";
    }
  };

  // Tiered bar height: high -> tall, average -> medium, low -> short.
  // Height still scales a bit within each tier by magnitude of deviation.
  const barHeightPct = (d) => {
    const tier = tierOf(d);
    if (tier === "zero") return 3;

    const pct = Math.abs(pctVsAvg(d));
    const magnitude = Math.min(pct, 100) / 100; // 0..1

    switch (tier) {
      case "high":
        return Math.round(65 + magnitude * 35); // 65–100%
      case "low":
        return Math.round(Math.max(35 - magnitude * 23, 12)); // 12–35%
      default:
        return Math.round(35 + magnitude * 30); // 35–65%
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
              background: "var(--panel2)",
              border: "1px solid var(--b2)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              whiteSpace: "nowrap",
              zIndex: 50,
              pointerEvents: "none",
              fontSize: 13,
              minWidth: 160,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14, color: "var(--t1)" }}>{formatDate(hovered.d.date)}</div>
            <div style={{ color: "var(--t2)", marginBottom: 2 }}>{fmt(hovered.d.value)}</div>
            {hovered.d.value > 0 && (
              <div
                style={{
                  marginTop: 6,
                  fontWeight: 700,
                  fontSize: 14,
                  color: tierColor(tierOf(hovered.d)),
                }}
              >
                {pctLabel(hovered.d)} vs avg
              </div>
            )}
            <div style={{ marginTop: 4, color: "var(--t2)", fontSize: 12 }}>
              {signalLabel(hovered.d)}
            </div>
          </div>
        )}

        {series.map((d, i) => {
          const isZero = d.value === 0;
          const height = barHeightPct(d);
          const leftPct = ((i + 0.5) / series.length) * 100;

          return (
            <div
              key={d.date + i}
              className="cb"
              onMouseEnter={() => setHovered({ d, leftPct })}
              onMouseLeave={() => setHovered(null)}
              style={{
                height: `${height}%`,
                background: isZero ? "var(--t3)" : color,
                borderRadius: "6px 6px 0 0",
                opacity: isZero ? 0.35 : 0.85,
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