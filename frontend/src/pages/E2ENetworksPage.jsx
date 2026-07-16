import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import ExportButton from "../components/ExportButton";
import MonthlySpendCard from "../components/MonthlySpendCard";
import { monthToDateLabel } from "../utils/dateRangeLabel";

function fmtINR(value) {
  if (value == null || value === "—") return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return "₹" + Math.round(num).toLocaleString("en-IN");
}

function formatHours(hours = 0) {
  return `${hours.toFixed(1)}h`;
}

function formatDrivers(drivers, fmt) {
  if (!drivers?.length) return null;
  return drivers
    .map(d => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${d.pct_vs_baseline > 0 ? "+" : ""}${d.pct_vs_baseline}% vs avg)`)
    .join(", ");
}

export default function E2ENetworksPage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("e2e", days, syncVersion);
  const [history, setHistory] = useState([]);
  const fmt = fmtINR;

  useEffect(() => {
    api.getAnomalies("e2e").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading E2E Networks data...</div>;
  if (error) return <div className="error-state">Couldn't load E2E Networks data: {error}</div>;
  if (!data) return null;

  const isAnomaly = data.anomaly?.is_anomaly;
  const deltaPct = data.anomaly?.pct_vs_baseline;
  const runningNodes = data.nodes?.filter((node) => node.status === "Running") ?? [];
  const liveCostPerHr = runningNodes.reduce((sum, n) => sum + (n.cost_per_hr || 0), 0);
  const periodTotal = (data.daily_series || []).reduce((sum, d) => sum + (d.value || 0), 0);

  const mtdDeltaPct = data.vs_last_month_pct;
  const mtdDelta = mtdDeltaPct != null ? `${mtdDeltaPct > 0 ? "+" : ""}${mtdDeltaPct}% vs last month` : monthToDateLabel();
  const mtdDeltaClass = mtdDeltaPct != null ? (mtdDeltaPct > 0 ? "d-up" : mtdDeltaPct < 0 ? "d-dn" : "d-flat") : "d-flat";

  return (
    <div className="page" id="page-e2e">
      {isAnomaly && (
        <div className="a-banner">
          <div className="a-icon">!</div>
          <div>
            <div className="a-title">Spend anomaly - today</div>
            <div className="a-text">
              {fmt(data.today)} today vs baseline ~{fmt(data.anomaly.baseline_mean)}/day
              ({deltaPct > 0 ? "+" : ""}{deltaPct}%, z-score {data.anomaly.z_score}).
              {formatDrivers(data.anomaly_drivers, fmt)
                ? ` Driven by: ${formatDrivers(data.anomaly_drivers, fmt)}.`
                : " Check for runaway compute instances or forgotten node allocations."}
            </div>
          </div>
        </div>
      )}

      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--cyan)" }}>E2E Networks</span></div>
        <div className="ph-sub">
          GPU/CPU compute - node-level cost tracking
          {data.as_of && ` · as of ${data.as_of}`}
        </div>
      </div>

      {data._error && (
        <div className="a-banner">
          <div className="a-icon">!</div>
          <div>
            <div className="a-title">API Connection Error</div>
            <div className="a-text">
              Failed to load live data for this provider: {data._error}. Please check credentials or API access.
            </div>
          </div>
        </div>
      )}

      {data.empty_data_reason && (
        <div className="a-banner" style={{ background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
          <div className="a-icon" style={{ background: "var(--orange)", color: "#fff" }}>!</div>
          <div>
            <div className="a-title" style={{ color: "var(--orange)" }}>Billing Activity Notice</div>
            <div className="a-text" style={{ color: "var(--t2)" }}>
              {data.empty_data_reason}
            </div>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard accent="cyan" label="Today" value={fmt(data.today)}
          valueColor={isAnomaly ? "var(--danger)" : undefined}
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null}
          deltaClass={isAnomaly ? "d-up" : "d-flat"} />
        <KpiCard accent="cyan" label="Month to date" value={fmt(data.month_to_date)} delta={mtdDelta} deltaClass={mtdDeltaClass} />
        <KpiCard accent="cyan" label="Projected month-end" value={fmt(data.projected_month_end || 0)}
          delta="Simple run-rate projection" deltaClass="d-flat" />
        <KpiCard accent="cyan" label={`Total - ${days}d`} value={fmt(periodTotal)}
          delta={`across ${data.daily_series?.length || days} days`}
          deltaClass="d-flat" />
        <KpiCard accent="cyan" label="Active nodes" value={data.active_nodes_count}
          delta={`${runningNodes.length} running now`}
          deltaClass="d-flat" />
        <KpiCard accent="cyan" label="Node hours today" value={`${formatHours(data.gpu_hours_today)} GPU / ${formatHours(data.cpu_hours_today)} CPU`} />
        <KpiCard accent="cyan" label="Free tier hours remaining" value={`${formatHours(data.free_tier_hours_remaining)}`}
          delta={`${formatHours(data.free_tier_hours_used)} used this month (of 2.0h)`}
          deltaClass="d-flat" />
      </div>
      <ExportButton data={data} filename="e2e_networks_data.json" label="Export Details" />

      <div className="da-grid">
        <MonthlySpendCard providerKey="e2e" accent="cyan" formatter={fmt} />
        <div className="da-card" data-accent="cyan">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: isAnomaly ? "var(--danger)" : "var(--cyan)" }}>{data.anomaly?.z_score ?? "-"}</div>
          <div className="da-sub">threshold: 2.0</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">GPU Node Hours</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{formatHours(data.gpu_hours_today)}</div>
          <div className="da-sub">Billed hourly beyond free tier</div>
        </div>
        <div className="da-card" data-accent="violet">
          <div className="da-label">CPU Node Hours</div>
          <div className="da-val" style={{ color: "var(--violet)" }}>{formatHours(data.cpu_hours_today)}</div>
          <div className="da-sub">Unlimited free CPU node time</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel panel--chart">
          <div className="panel-hdr">
            <div className="panel-title">Node spend - {days} days</div>
          </div>
          {data.empty_data_reason ? (
            <div className="empty-state" style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <div style={{ color: "var(--t2)", fontWeight: 500 }}>No chart data to display</div>
              <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 4 }}>{data.empty_data_reason}</div>
            </div>
          ) : (
            <DailyBarChart series={data.daily_series} color="var(--cyan)" highlightLast={isAnomaly} formatter={fmt} />
          )}
        </div>
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Active Nodes</div>
            <div className="panel-stat">{fmt(liveCostPerHr)}/hr live</div>
          </div>
          {!data.nodes?.length && <div className="empty-state">No active nodes currently running.</div>}
          {data.nodes?.map((node) => {
            const flagged = node.cost_per_hr > 100; // Flag high-cost instances
            return (
              <div className={`pod${flagged ? " alert" : ""}`} key={node.id}>
                <div className="pod-hdr">
                  <span className="pod-name">{node.name}</span>
                  <div className="pod-pills">
                    <span className="pill p-violet">{node.gpu !== "CPU Only" ? "GPU Compute" : "CPU Compute"}</span>
                    <span className={`pill ${node.status === "Running" ? "p-ok" : "p-warn"}`}>{node.status}</span>
                  </div>
                </div>
                <div className="pod-meta">
                  Plan: {node.plan} · GPU: {node.gpu}
                </div>
                <div className="pod-metrics">
                  <div>
                    <span>Hourly Rate</span>
                    <strong>{fmt(node.cost_per_hr)}/hr</strong>
                  </div>
                  <div>
                    <span>Public IP</span>
                    <strong>{node.public_ip_address || "None"}</strong>
                  </div>
                  <div>
                    <span>Private IP</span>
                    <strong>{node.private_ip_address || "None"}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data.historical_spikes && data.historical_spikes.length > 0 && (
        <div className="panel panel--spikes">
          <div className="panel-hdr">
            <div className="panel-title">⚠️ Spend Spikes Analyzer</div>
            <div className="panel-sub" style={{ fontSize: 12, color: "var(--t3)" }}>
              Detects days where spend exceeded the trailing 7-day average by &gt; 30% and &gt; ₹50.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {data.historical_spikes.map((spike, idx) => (
              <div key={idx} style={{
                background: "rgba(239, 68, 68, 0.03)",
                border: "1px solid rgba(239, 68, 68, 0.12)",
                borderRadius: 8,
                padding: "14px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap"
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, color: "var(--t1)", fontSize: 14 }}>{spike.date}</span>
                    <span className="pill p-warn" style={{ color: "var(--danger)", background: "rgba(239, 68, 68, 0.1)" }}>
                      +{spike.pct_increase}% spike
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 6 }}>
                    Top Driver: <strong style={{ color: "var(--cyan)" }}>{spike.top_driver}</strong>
                    {" "}(spiked by <span style={{ color: "var(--danger)", fontWeight: 500 }}>+{fmt(spike.driver_increase)}</span> vs baseline)
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--t3)" }}>Daily Spend</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--danger)", marginTop: 2 }}>{fmt(spike.value)}</div>
                  <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>baseline: {fmt(spike.baseline_mean)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">SKU / Node Type cost breakdown</div></div>
        <BreakdownPanel provider="e2e" items={data.node_breakdown} formatter={fmt} />
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Waste & Inefficiency</div></div>
        {!data.possible_idle_nodes?.length && <div className="empty-state">No long-running/idle compute nodes detected.</div>}
        <div className="svc-list">
          {data.possible_idle_nodes?.map((node) => {
            const daysRunning = Math.round(node.uptime_seconds / 86400);
            return (
              <div className="svc-row" key={node.id}>
                <span className="svc-name" title={node.name}>{node.name} ({node.gpu})</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: "100%", background: "var(--danger)" }} />
                </div>
                <span className="svc-pct">{daysRunning} days running</span>
                <span className="svc-amt">{fmt(node.cost_per_hr)}/hr</span>
              </div>
            );
          })}
        </div>
      </div>

      {history && history.length > 0 && (
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">E2E Anomaly history</div></div>
          <AnomalyHistory items={history.map(h => ({ ...h, message: h.message }))} />
        </div>
      )}
    </div>
  );
}
