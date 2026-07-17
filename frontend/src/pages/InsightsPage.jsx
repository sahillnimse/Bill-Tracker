import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client";

const ROUTE_MAP = {
  aws: "/aws",
  runpod: "/runpod",
  google_ads: "/google-ads",
  ms365: "/ms365",
  e2e: "/e2e",
};

function severityClass(severity) {
  if (severity === "warn") return "a-banner--warn";
  return "";
}

export default function InsightsPage({ days = 30, syncVersion = 0 }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getInsights(days)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load insights");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days, syncVersion]);

  if (loading) return <div className="loading-state">Loading insights…</div>;
  if (error) return <div className="error-state">Couldn't load insights: {error}</div>;
  const { insights, generated_at, ai_summary } = data;

  return (
    <div className="page" id="page-insights">
      <div className="ph">
        <div className="ph-title">Insights</div>
        <div className="ph-sub">Everything unusual, explained — across every provider</div>
      </div>

      {ai_summary && (
        <div className="a-banner" style={{ marginTop: 24, borderColor: "var(--cyan)" }}>
          <div className="a-icon" style={{ background: "var(--cyan)" }}>✨</div>
          <div>
            <div className="a-title">Today's Summary</div>
            <div className="a-text">{ai_summary}</div>
          </div>
        </div>
      )}

      {insights.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 24, textAlign: "center", padding: "48px 24px" }}>
          Nothing unusual right now — all providers are within normal range.
        </div>
      ) : (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          {insights.map((item, idx) => (
            <div key={idx} className={`a-banner ${severityClass(item.severity)}`}>
              <div className="a-icon">{item.severity === "danger" ? "!" : "i"}</div>
              <div style={{ flex: 1 }}>
                <div className="a-title">{item.provider_label}</div>
                <div className="a-text">{item.explanation}</div>
                <button
                  className="anomaly-strip2-cta"
                  style={{
                    marginTop: 8,
                    background: "none",
                    border: "none",
                    color: "var(--cyan)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 13,
                  }}
                  onClick={() => navigate(ROUTE_MAP[item.provider] || `/${item.provider}`)}
                >
                  View details →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
