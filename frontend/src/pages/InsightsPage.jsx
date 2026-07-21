import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import api from "../api/client";

const ROUTE_MAP = {
  aws: "/aws",
  runpod: "/runpod",
  google_ads: "/google-ads",
  ms365: "/ms365",
  e2e: "/e2e",
};

const PROVIDER_COLORS = {
  aws: "var(--aws)",
  runpod: "var(--runpod)",
  google_ads: "var(--gads)",
  ms365: "var(--ms)",
  e2e: "var(--cyan)",
};

function spendValue(snapshot) {
  // month_to_date is the most representative figure for most providers;
  // ms365 reports monthly_bill instead.
  return snapshot.month_to_date ?? snapshot.monthly_bill ?? snapshot.today ?? 0;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0].payload;
  if (item.status === "error") {
    return (
      <div
        style={{
          background: "var(--panel, #16181d)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          maxWidth: 220,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
        <div style={{ color: "var(--t3, #888)" }}>Data unavailable — API issue</div>
      </div>
    );
  }
  return (
    <div
      style={{
        background: "var(--panel, #16181d)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
      <div>${item.value.toFixed(2)}</div>
    </div>
  );
}

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
  const { insights, generated_at, ai_summary, snapshots = [] } = data;

  const chartData = snapshots.map((s) => ({
    provider: s.provider,
    label: s.label,
    value: spendValue(s),
    status: s._status === "error" ? "error" : "ok",
  }));
  const okData = chartData.filter((s) => s.status === "ok");
  const totalSpend = okData.reduce((sum, s) => sum + s.value, 0);
  const topProvider = okData.length
    ? okData.reduce((max, s) => (s.value > max.value ? s : max), okData[0])
    : null;
  const trending = snapshots
    .filter((s) => typeof s.vs_last_month_pct === "number")
    .sort((a, b) => Math.abs(b.vs_last_month_pct) - Math.abs(a.vs_last_month_pct))[0];
  const erroredProviders = chartData.filter((s) => s.status === "error");

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

      {chartData.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div className="a-banner" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <div className="a-text" style={{ opacity: 0.7, fontSize: 12 }}>TOTAL SPEND</div>
              <div className="a-title" style={{ fontSize: 22 }}>${totalSpend.toFixed(2)}</div>
            </div>
            {topProvider && (
              <div className="a-banner" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <div className="a-text" style={{ opacity: 0.7, fontSize: 12 }}>TOP SPENDER</div>
                <div className="a-title" style={{ fontSize: 22 }}>{topProvider.label}</div>
              </div>
            )}
            {trending && (
              <div className="a-banner" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <div className="a-text" style={{ opacity: 0.7, fontSize: 12 }}>BIGGEST MOVE</div>
                <div
                  className="a-title"
                  style={{ fontSize: 22, color: trending.vs_last_month_pct >= 0 ? "var(--aws)" : "var(--gads)" }}
                >
                  {trending.vs_last_month_pct >= 0 ? "▲" : "▼"} {Math.abs(trending.vs_last_month_pct).toFixed(1)}%
                </div>
                <div className="a-text" style={{ fontSize: 12 }}>{trending.label}</div>
              </div>
            )}
          </div>

          <div className="a-banner" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div className="a-title" style={{ marginBottom: 12 }}>Spend by provider</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="35%" barSize={44}>
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "currentColor" }} />
                <YAxis tick={{ fontSize: 12, fill: "currentColor" }} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={52}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.provider}
                      fill={entry.status === "error" ? "var(--border, #2a2b31)" : (PROVIDER_COLORS[entry.provider] || "var(--cyan)")}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {erroredProviders.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--t3, #888)", display: "flex", flexDirection: "column", gap: 4 }}>
                {erroredProviders.map((p) => (
                  <div key={p.provider}>
                    {p.label}: data unavailable — API issue. Will show once resolved.
                  </div>
                ))}
              </div>
            )}
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