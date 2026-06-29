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
            {item.emailed && <span className="emailed">emailed</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
