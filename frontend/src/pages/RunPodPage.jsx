import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";

function formatRuntime(seconds = 0) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function RunPodPage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("runpod", days, syncVersion);
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("runpod").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading RunPod data…</div>;
  if (error) return <div className="error-state">Couldn't load RunPod data: {error}</div>;
  if (!data) return null;

  const isAnomaly = data.anomaly?.is_anomaly;
  const deltaPct = data.anomaly?.pct_vs_baseline;

  return (
    <div className="page" id="page-runpod">
      {isAnomaly && (
        <div className="a-banner">
          <div className="a-icon">!</div>
          <div>
            <div className="a-title">GPU spend anomaly · today</div>
            <div className="a-text">
              {fmt(data.today)} today vs baseline ~{fmt(data.anomaly.baseline_mean)}/day
              ({deltaPct > 0 ? "+" : ""}{deltaPct}%, z-score {data.anomaly.z_score}).
              Check for runaway training jobs or forgotten sessions.
            </div>
          </div>
        </div>
      )}

      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--runpod)" }}>●</span> RunPod</div>
        <div className="ph-sub">GPU compute · pod-level cost tracking</div>
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

      <div className="kpi-grid">
        <KpiCard accent="runpod" label="Today" value={fmt(data.today)}
          valueColor={isAnomaly ? "var(--danger)" : undefined}
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null}
          deltaClass={isAnomaly ? "d-up" : "d-flat"} />
        <KpiCard accent="runpod" label="Active pods" value={data.active_pods_count}
          delta={data.pods?.some((p) => p.estimated_cost > 10) ? "1+ flagged" : null}
          deltaClass="d-flat" />
        <KpiCard accent="runpod" label="GPU hours today" value={`${data.gpu_hours_today}h`} />
        <KpiCard accent="runpod" label="Month to date" value={fmt(data.month_to_date)} />
      </div>
      <ExportButton data={data} filename="runpod_data.json" label="Export Details" />

      <div className="da-grid">
        <div className="da-card" data-accent="runpod">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: isAnomaly ? "var(--danger)" : "var(--runpod)" }}>{data.anomaly?.z_score ?? "—"}</div>
          <div className="da-sub">threshold: 2.0</div>
        </div>
        <div className="da-card" data-accent="pink">
          <div className="da-label">Baseline mean/day</div>
          <div className="da-val" style={{ color: "var(--pink)" }}>{fmt(data.anomaly?.baseline_mean)}</div>
          <div className="da-sub">trailing window avg</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Active pods running</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{data.active_pods_count}</div>
          <div className="da-sub">across all GPU types</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel panel--chart">
          <div className="panel-hdr">
            <div className="panel-title">GPU spend · {days} days</div>
          </div>
          <DailyBarChart series={data.daily_series} color="#e879f9" highlightLast={isAnomaly} />
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Active pods</div></div>
          {!data.pods?.length && <div className="empty-state">No pods currently running.</div>}
          {data.pods?.map((pod) => {
            const flagged = pod.estimated_cost > 10;
            return (
              <div className={`pod${flagged ? " alert" : ""}`} key={pod.id}>
                <div className="pod-hdr">
                  <span className="pod-name">{pod.name}</span>
                  <span className={`pill ${flagged ? "p-danger" : "p-ok"}`}>{flagged ? "Flagged" : "Normal"}</span>
                </div>
                <div className="pod-meta">
                  Runtime {formatRuntime(pod.uptime_seconds)} · {fmt(pod.cost_per_hr)}/hr · Est. {fmt(pod.estimated_cost)}
                </div>
                <div className="pod-bar">
                  <div className="pod-fill" style={{ width: `${Math.min(pod.estimated_cost, 100)}%`, background: flagged ? "var(--danger)" : "var(--ok)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">GPU type cost breakdown · running pods</div></div>
        <BreakdownPanel provider="runpod" items={data.gpu_breakdown} />
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}