import { useCurrency } from "../context/CurrencyContext";

// Richer, dark-theme-optimised palettes per provider
const COLORS_BY_PROVIDER = {
  aws: [
    { bar: "#FF9F43", glow: "rgba(255,159,67,0.18)", text: "#FF9F43" },
    { bar: "#fb923c", glow: "rgba(251,146,60,0.14)",  text: "#fb923c" },
    { bar: "#fbbf24", glow: "rgba(251,191,36,0.14)",  text: "#fbbf24" },
    { bar: "#f59e0b", glow: "rgba(245,158,11,0.14)",  text: "#f59e0b" },
    { bar: "#d97706", glow: "rgba(217,119,6,0.12)",   text: "#d97706" },
  ],
  runpod: [
    { bar: "#C76BFF", glow: "rgba(199,107,255,0.20)", text: "#C76BFF" },
    { bar: "#a855f7", glow: "rgba(168,85,247,0.17)",  text: "#a855f7" },
    { bar: "#818cf8", glow: "rgba(129,140,248,0.15)", text: "#818cf8" },
    { bar: "#38bdf8", glow: "rgba(56,189,248,0.13)",  text: "#38bdf8" },
    { bar: "#34d399", glow: "rgba(52,211,153,0.13)",  text: "#34d399" },
  ],
  gads: [
    { bar: "#4C9AFF", glow: "rgba(76,154,255,0.18)",  text: "#4C9AFF" },
    { bar: "#60a5fa", glow: "rgba(96,165,250,0.15)",  text: "#60a5fa" },
    { bar: "#818cf8", glow: "rgba(129,140,248,0.14)", text: "#818cf8" },
    { bar: "#a78bfa", glow: "rgba(167,139,250,0.13)", text: "#a78bfa" },
    { bar: "#c084fc", glow: "rgba(192,132,252,0.12)", text: "#c084fc" },
  ],
};

const FALLBACK = [
  { bar: "#00E5D4", glow: "rgba(0,229,212,0.15)", text: "#00E5D4" },
  { bar: "#38bdf8", glow: "rgba(56,189,248,0.13)", text: "#38bdf8" },
  { bar: "#818cf8", glow: "rgba(129,140,248,0.13)", text: "#818cf8" },
  { bar: "#a855f7", glow: "rgba(168,85,247,0.13)", text: "#a855f7" },
  { bar: "#f472b6", glow: "rgba(244,114,182,0.12)", text: "#f472b6" },
];

export default function BreakdownPanel({ provider, items = [], unit = "$", topLabel }) {
  const { fmt } = useCurrency();
  const palette = COLORS_BY_PROVIDER[provider] || FALLBACK;
  const top = items[0];
  const topPct = top ? Math.round(top.pct) : 0;
  const circumference = 188.4;
  const topArc = (topPct / 100) * circumference;
  const c0 = palette[0];

  if (!items.length) {
    return <div className="empty-state">No breakdown data yet.</div>;
  }

  return (
    <div className="bp-wrap">
      {/* Donut */}
      <div className="bp-donut-col">
        <div className="donut-wrap">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
            <circle
              cx="40" cy="40" r="30" fill="none"
              stroke={c0.bar} strokeWidth="10"
              strokeDasharray={`${topArc} ${circumference}`}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 6px ${c0.bar})` }}
            />
          </svg>
          <div className="donut-label">
            <div className="donut-pct" style={{ color: c0.bar }}>{topPct}%</div>
            <div className="donut-sub">{topLabel || "top"}</div>
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="bp-list">
        {items.slice(0, 5).map((item, i) => {
          const col = palette[i] || palette[palette.length - 1];
          return (
            <div className="bp-row" key={item.name} style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }}>
              <div className="bp-color-dot" style={{ background: col.bar, boxShadow: `0 0 6px ${col.bar}` }} />
              <div className="bp-name" title={item.name}>{item.name}</div>
              <div className="bp-track-wrap">
                <div className="bp-track">
                  <div
                    className="bp-fill"
                    style={{
                      width: `${Math.max(item.pct, 1)}%`,
                      background: `linear-gradient(90deg, ${col.bar}, ${col.bar}cc)`,
                      boxShadow: `0 0 8px ${col.glow}`,
                      animationDelay: `${(i * 0.08).toFixed(2)}s`,
                    }}
                  />
                </div>
              </div>
              <span className="bp-pct" style={{ color: col.text }}>{item.pct}%</span>
              <span className="bp-amt">
                {unit === "$" ? fmt(item.amount) : (item.events?.toLocaleString() ?? item.amount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}