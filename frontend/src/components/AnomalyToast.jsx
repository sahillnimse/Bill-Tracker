import { useEffect, useState } from "react";

function anomalyKey(a) {
  return a.id != null ? `id-${a.id}` : `${a.provider}-${a.date}-${a.method || "z_score"}`;
}

export default function AnomalyToast({ anomalies = [] }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem("dismissedAnomalies") || "[]"));
    } catch {
      return new Set();
    }
  });

  const visible = anomalies.filter((a) => !dismissed.has(anomalyKey(a)));

  function dismiss(key) {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    sessionStorage.setItem("dismissedAnomalies", JSON.stringify([...next]));
  }

  if (!visible.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        right: 20,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 340,
      }}
    >
      {visible.map((a) => {
        const key = anomalyKey(a);
        const methodLabel = a.method === "sma" ? "SMA 7/20" : "Z-score";
        return (
          <div
            key={key}
            style={{
              background: "var(--panel-bg, #14151a)",
              border: "1px solid var(--border, #2a2b31)",
              borderLeft: "3px solid var(--amber, #f5a623)",
              borderRadius: 8,
              padding: "10px 12px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              animation: "toastIn 0.2s ease-out",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--t2, #aaa)", fontWeight: 600 }}>
                Anomaly detected
              </div>
              <button
                onClick={() => dismiss(key)}
                style={{ background: "none", border: "none", color: "var(--t3, #888)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--t1, #eee)", marginTop: 4 }}>
              {a.message}
            </div>
            <div style={{ fontSize: 11, color: "var(--t3, #888)", marginTop: 6 }}>
              Flagged via {methodLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}