const COLORS_BY_PROVIDER = {
  aws: ["var(--aws)", "#fb923c", "#fdba74", "#fde68a", "rgba(249,115,22,0.3)"],
  runpod: ["var(--runpod)", "#d946ef", "#a855f7", "#c084fc", "rgba(232,121,249,0.3)"],
  ga4: ["var(--ga)", "#6ee7b7", "#a7f3d0", "#d1fae5", "rgba(16,185,129,0.3)"],
  gads: ["var(--gads)", "#60a5fa", "#93c5fd", "#bfdbfe", "rgba(59,130,246,0.3)"],
};

export default function BreakdownPanel({ provider, items = [], unit = "$", topLabel }) {
  const palette = COLORS_BY_PROVIDER[provider] || COLORS_BY_PROVIDER.aws;
  const top = items[0];
  const topPct = top ? Math.round(top.pct) : 0;
  // Circumference for r=30 circle: 2*pi*30 = 188.4
  const circumference = 188.4;
  const topArc = (topPct / 100) * circumference;

  if (!items.length) {
    return <div className="empty-state">No breakdown data yet.</div>;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
      <div className="donut-wrap">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle
            cx="40" cy="40" r="30" fill="none"
            stroke={palette[0]} strokeWidth="10"
            strokeDasharray={`${topArc} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="donut-label">
          <div className="donut-pct" style={{ color: palette[0] }}>{topPct}%</div>
          <div className="donut-sub">{topLabel || top?.name}</div>
        </div>
      </div>
      <div className="svc-list" style={{ flex: 1 }}>
        {items.slice(0, 5).map((item, i) => (
          <div className="svc-row" key={item.name}>
            <span className="svc-name">{item.name}</span>
            <div className="svc-track">
              <div
                className="svc-fill"
                style={{
                  width: `${Math.max(item.pct, 2)}%`,
                  background: palette[i] || palette[palette.length - 1],
                  animationDelay: `${(i * 0.07).toFixed(2)}s`,
                }}
              />
            </div>
            <span className="svc-pct" style={{ color: palette[i] || palette[palette.length - 1] }}>
              {item.pct}%
            </span>
            <span className="svc-amt">
              {unit === "$" ? `$${item.amount}` : item.events?.toLocaleString() ?? item.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
