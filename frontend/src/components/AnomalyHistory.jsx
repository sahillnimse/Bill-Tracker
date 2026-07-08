export default function AnomalyHistory({ items = [] }) {
  if (!items.length) {
    return (
      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Anomaly history</div></div>
        <div className="empty-state">No anomalies recorded yet for this provider.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-hdr"><div className="panel-title">Anomaly history</div></div>
      {items.map((item, i) => (
        <div className="hrow" key={i} style={{ animationDelay: `${i * 0.1}s` }}>
          <div className="hdate">{item.date}</div>
          <div>
            <div className="htext">{item.message}</div>
            <span className="method-tag" style={{ fontSize: 10, color: "var(--t3, #888)", marginRight: 6 }}>
              {item.method === "sma" ? "SMA 7/20" : "Z-score"}
            </span>
            {item.emailed && <span className="emailed">emailed</span>}
          </div>
        </div>
      ))}
    </div>
  );
}