export default function KpiCard({ accent, label, value, valueColor, delta, deltaClass }) {
  return (
    <div className="kc" data-accent={accent}>
      <div className="kc-shine"></div>
      <div className="kc-label">{label}</div>
      <div className="kc-val" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {delta && <div className={`kc-delta ${deltaClass || "d-flat"}`}>{delta}</div>}
    </div>
  );
}
