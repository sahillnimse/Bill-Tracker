import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import Sparkline from "../components/Sparkline";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";
import MonthlySpendCard from "../components/MonthlySpendCard";
import { monthToDateLabel } from "../utils/dateRangeLabel";

function formatRuntime(seconds = 0) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function pct(part = 0, total = 0) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function formatDrivers(drivers, fmt) {
  if (!drivers?.length) return null;
  return drivers
    .map(d => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${d.pct_vs_baseline > 0 ? "+" : ""}${d.pct_vs_baseline}% vs avg)`)
    .join(", ");
}

export default function RunPodPage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("runpod", days, syncVersion);
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("runpod").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading RunPod data...</div>;
  if (error) return <div className="error-state">Couldn't load RunPod data: {error}</div>;
  if (!data) return null;

  const isAnomaly = data.anomaly?.is_anomaly;
  const deltaPct = data.anomaly?.pct_vs_baseline;
  const runningPods = data.pods?.filter((pod) => pod.status === "RUNNING") ?? [];
  const liveCostPerHr = (data.spot_cost_per_hr || 0) + (data.secure_cost_per_hr || 0);
  const spotPct = pct(data.spot_cost_per_hr, liveCostPerHr);
  const securePct = pct(data.secure_cost_per_hr, liveCostPerHr);
  const periodTotal = (data.daily_series || []).reduce((sum, d) => sum + (d.value || 0), 0);

  const podSpendTotal = (data.gpu_breakdown || []).reduce((sum, g) => sum + (g.amount || 0), 0);
  const serverlessSpendTotal = (data.endpoint_breakdown || []).reduce((sum, e) => sum + (e.amount || 0), 0);
  const podVsServerlessTotal = podSpendTotal + serverlessSpendTotal;
  const podVsServerlessDenom = podVsServerlessTotal || 1; // safe denominator only — never shown in UI
  const podSharePct = Math.round((podSpendTotal / podVsServerlessDenom) * 100);
  const serverlessSharePct = Math.round((serverlessSpendTotal / podVsServerlessDenom) * 100);

  const mtdDeltaPct = data.vs_last_month_pct;
  const mtdDelta = mtdDeltaPct != null ? `${mtdDeltaPct > 0 ? "+" : ""}${mtdDeltaPct}% vs last month` : monthToDateLabel();
  const mtdDeltaClass = mtdDeltaPct != null ? (mtdDeltaPct > 0 ? "d-up" : mtdDeltaPct < 0 ? "d-dn" : "d-flat") : "d-flat";

  return (
    <div className="page" id="page-runpod">
      {isAnomaly && (
        <div className="a-banner">
          <div className="a-icon">!</div>
          <div>
            <div className="a-title">GPU spend anomaly - today</div>
            <div className="a-text">
              {fmt(data.today)} today vs baseline ~{fmt(data.anomaly.baseline_mean)}/day
              ({deltaPct > 0 ? "+" : ""}{deltaPct}%, z-score {data.anomaly.z_score}).
              {formatDrivers(data.anomaly_drivers, fmt)
                ? ` Driven by: ${formatDrivers(data.anomaly_drivers, fmt)}.`
                : " Check for runaway training jobs or forgotten sessions."}
            </div>
          </div>
        </div>
      )}

      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--runpod)" }}>RunPod</span></div>
        <div className="ph-sub">
          GPU compute - pod-level cost tracking
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
        <KpiCard accent="runpod" label="Today" value={fmt(data.today)}
          valueColor={isAnomaly ? "var(--danger)" : undefined}
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null}
          deltaClass={isAnomaly ? "d-up" : "d-flat"} />
        <KpiCard accent="runpod" label="Month to date" value={fmt(data.month_to_date)} delta={mtdDelta} deltaClass={mtdDeltaClass} />
        <KpiCard accent="runpod" label="Projected month-end" value={fmt(data.projected_month_end || 0)}
          delta="Simple run-rate projection" deltaClass="d-flat" />
        <KpiCard accent="runpod" label={`Total - ${days}d`} value={fmt(periodTotal)}
          delta={`across ${data.daily_series?.length || days} days`}
          deltaClass="d-flat" />
        <KpiCard accent="runpod" label="Active pods" value={data.active_pods_count}
          delta={data.pods?.some((p) => p.estimated_cost > 10) ? "1+ flagged" : null}
          deltaClass="d-flat" />
        <KpiCard accent="runpod" label="GPU hours today" value={`${data.gpu_hours_today}h`} />
        <KpiCard accent="runpod" label="Savings / hr" value={fmt(data.total_savings_per_hr || 0)}
          delta={`${data.total_running_gpus || 0} active GPUs`}
          deltaClass="d-flat" />
      </div>
      <ExportButton data={data} filename="runpod_data.json" label="Export Details" />

      <div className="da-grid">
        <MonthlySpendCard providerKey="runpod" accent="runpod" />
        <div className="da-card" data-accent="runpod">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: isAnomaly ? "var(--danger)" : "var(--runpod)" }}>{data.anomaly?.z_score ?? "-"}</div>
          <div className="da-sub">threshold: 2.0</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Spot capacity</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{fmt(data.spot_cost_per_hr || 0)}/hr</div>
          <div className="da-sub">{data.spot_count || 0} pods - {spotPct}% of live cost</div>
        </div>
        <div className="da-card" data-accent="violet">
          <div className="da-label">Secure capacity</div>
          <div className="da-val" style={{ color: "var(--violet)" }}>{fmt(data.secure_cost_per_hr || 0)}/hr</div>
          <div className="da-sub">{data.secure_count || 0} pods - {securePct}% of live cost</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel panel--chart">
          <div className="panel-hdr">
            <div className="panel-title">GPU spend - {days} days</div>
          </div>
          {data.empty_data_reason ? (
            <div className="empty-state" style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <div style={{ color: "var(--t2)", fontWeight: 500 }}>No chart data to display</div>
              <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 4 }}>{data.empty_data_reason}</div>
            </div>
          ) : (
            <DailyBarChart series={data.daily_series} color="#e879f9" highlightLast={isAnomaly} />
          )}
        </div>
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Active pods</div>
            <div className="panel-stat">{fmt(liveCostPerHr)}/hr live</div>
          </div>
          {!data.pods?.length && <div className="empty-state">No pods currently running.</div>}
          {data.pods?.map((pod) => {
            const flagged = pod.estimated_cost > 10;
            const gpuCount = pod.gpu_count || 1;
            const adjustedRate = pod.adjusted_cost_per_hr ?? pod.cost_per_hr;
            const perGpuRate = pod.adjusted_cost_per_gpu_hr ?? adjustedRate / gpuCount;
            const hasSavings = (pod.savings_per_hr || 0) > 0;

            return (
              <div className={`pod${flagged ? " alert" : ""}`} key={pod.id}>
                <div className="pod-hdr">
                  <span className="pod-name">{pod.name}</span>
                  <div className="pod-pills">
                    <span className={`pill ${pod.interruptible ? "p-warn" : "p-violet"}`}>{pod.interruptible ? "Spot" : "Secure"}</span>
                    <span className={`pill ${flagged ? "p-danger" : "p-ok"}`}>{flagged ? "Flagged" : "Normal"}</span>
                  </div>
                </div>
                <div className="pod-meta">
                  {gpuCount} GPU{gpuCount === 1 ? "" : "s"} - {pod.gpu || "Unknown GPU"} - Runtime {formatRuntime(pod.uptime_seconds)}
                </div>
                <div className="pod-metrics">
                  <div>
                    <span>Actual</span>
                    <strong>{fmt(adjustedRate)}/hr</strong>
                  </div>
                  <div>
                    <span>Per GPU</span>
                    <strong>{fmt(perGpuRate)}/hr</strong>
                  </div>
                  <div>
                    <span>Saved</span>
                    <strong>{hasSavings ? `${fmt(pod.savings_per_hr)}/hr` : "None"}</strong>
                  </div>
                  <div>
                    <span>Disk</span>
                    <strong>{pod.container_disk_gb || 0} GB</strong>
                  </div>
                </div>
                <div className="pod-meta">
                  List {fmt(pod.cost_per_hr)}/hr - Est. active-run cost {fmt(pod.estimated_cost)}
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
        <div className="panel-hdr">
          <div className="panel-title">Spot vs secure - running pods</div>
          <div className="panel-stat">{runningPods.length} running - {data.total_running_gpus || 0} GPUs</div>
        </div>
        <div className="capacity-split">
          <div className="capacity-row">
            <div>
              <div className="capacity-name">Spot / community</div>
              <div className="capacity-sub">{data.spot_count || 0} pods - reclaimable capacity</div>
            </div>
            <div className="capacity-amount">{fmt(data.spot_cost_per_hr || 0)}/hr</div>
          </div>
          <div className="capacity-track">
            <div className="capacity-fill spot" style={{ width: `${spotPct}%` }} />
          </div>
          <div className="capacity-row">
            <div>
              <div className="capacity-name">Secure / on-demand</div>
              <div className="capacity-sub">{data.secure_count || 0} pods - guaranteed capacity</div>
            </div>
            <div className="capacity-amount">{fmt(data.secure_cost_per_hr || 0)}/hr</div>
          </div>
          <div className="capacity-track">
            <div className="capacity-fill secure" style={{ width: `${securePct}%` }} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">GPU type cost breakdown - pod spend</div></div>
        <BreakdownPanel provider="runpod" items={data.gpu_breakdown} />
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Serverless endpoint cost breakdown</div></div>
        {data.endpoint_breakdown?.length ? (
          <>
            <BreakdownPanel provider="runpod" items={data.endpoint_breakdown} topLabel="Top endpoint" />
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
              {data.endpoint_breakdown.slice(0, 5).map((ep) => (
                <div key={ep.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }} title={ep.name}>
                    {ep.name}
                  </span>
                  <div style={{ flex: 1, minWidth: 60 }}>
                    <Sparkline series={ep.daily_series} color="var(--runpod)" />
                  </div>
                  <span style={{ fontSize: 12.5, color: "var(--t1)", fontWeight: 600, minWidth: 60, textAlign: "right" }}>
                    {fmt(ep.amount)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">No serverless spend in this period.</div>
        )}
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Pods vs serverless - where the money went</div>
          <div className="panel-stat">{fmt(podVsServerlessTotal || 0)} total, {days}d</div>
        </div>
        <div className="capacity-split">
          <div className="capacity-row">
            <div>
              <div className="capacity-name">GPU pods</div>
              <div className="capacity-sub">{data.gpu_breakdown?.length || 0} GPU type{(data.gpu_breakdown?.length || 0) === 1 ? "" : "s"}</div>
            </div>
            <div className="capacity-amount">{fmt(podSpendTotal)}</div>
          </div>
          <div className="capacity-track">
            <div className="capacity-fill spot" style={{ width: `${podSharePct}%` }} />
          </div>
          <div className="capacity-row">
            <div>
              <div className="capacity-name">Serverless endpoints</div>
              <div className="capacity-sub">{data.endpoint_breakdown?.length || 0} endpoint{(data.endpoint_breakdown?.length || 0) === 1 ? "" : "s"}</div>
            </div>
            <div className="capacity-amount">{fmt(serverlessSpendTotal)}</div>
          </div>
          <div className="capacity-track">
            <div className="capacity-fill secure" style={{ width: `${serverlessSharePct}%` }} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Waste & Inefficiency</div></div>
        {!data.possible_idle_pods?.length && <div className="empty-state">No long-running/idle GPU pods detected.</div>}
        <div className="svc-list">
          {data.possible_idle_pods?.map((pod) => {
            const daysRunning = Math.round(pod.uptime_seconds / 86400);
            return (
              <div className="svc-row" key={pod.id}>
                <span className="svc-name" title={pod.name}>{pod.name} ({pod.gpu})</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: "100%", background: "var(--danger)" }} />
                </div>
                <span className="svc-pct">{daysRunning} days running</span>
                <span className="svc-amt">{fmt(pod.cost_per_hr)}/hr</span>
              </div>
            );
          })}
        </div>
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}
