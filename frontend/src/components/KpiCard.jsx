function TrendArrow({ deltaClass }) {
  if (deltaClass === "d-up") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 8V2M2 5l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (deltaClass === "d-dn") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 2v6M2 5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M2 5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function KpiCard({ accent, label, value, valueColor, delta, deltaClass, icon }) {
  return (
    <div className="kc" data-accent={accent}>
      <div className="kc-shine"></div>
      <div className="kc-glow"></div>
      <div className="kc-header">
        <div className="kc-label">{label}</div>
        {icon && <div className="kc-icon-badge">{icon}</div>}
      </div>
      <div className="kc-val" style={valueColor ? { color: valueColor } : undefined}>
        {value ?? "—"}
      </div>
      {delta != null && delta !== "" && (
        <div className={`kc-delta ${deltaClass || "d-flat"}`}>
          <TrendArrow deltaClass={deltaClass} />
          {delta}
        </div>
      )}
    </div>
  );
}