import { useNavigate } from "react-router-dom";
import KpiCard from "../components/KpiCard";
import Sparkline from "../components/Sparkline";
import { useCurrency } from "../context/CurrencyContext";

function pipClass(provider) {
  if (provider?.anomaly?.is_anomaly) return "pip-danger";
  if (provider?._status === "stale" || provider?._status === "error") return "pip-warn";
  return "pip-ok";
}

export default function Overview({ overview, loading, error }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();

  if (loading) return <div className="loading-state">Loading consolidated spend data…</div>;
  if (error) return <div className="error-state">Couldn't load overview: {error}</div>;
  if (!overview) return null;

  const { providers, today_total, month_to_date_total, projected_month_end, active_anomalies } = overview;
  const aws = providers.aws || {};
  const runpod = providers.runpod || {};
  const ga4 = providers.ga4 || {};
  const gads = providers.google_ads || {};
  const ms365 = providers.ms365 || {};

  const topAnomaly = active_anomalies?.[0];

  return (
    <div className="page" id="page-overview">
      <div className="ph">
        <div className="ph-title">
          <span
            style={{
              fontSize: 22,
              background: "linear-gradient(135deg,#818cf8,#e879f9,#f97316)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            SpendWatch
          </span>
        </div>
        <div className="ph-sub">All providers · consolidated · live data</div>
      </div>

      <div className="kpi-grid">
        <KpiCard accent="violet" label="Today · all providers"
          value={fmt(today_total)} valueColor="#a5b4fc" />
        <KpiCard accent="gads" label="Month to date"
          value={fmt(month_to_date_total)} valueColor="#93c5fd" />
        <KpiCard accent="ga" label="Projected month-end"
          value={fmt(projected_month_end)} valueColor="#6ee7b7"
          delta="at current run rate" deltaClass="d-flat" />
        <KpiCard accent="danger" label="Active anomalies"
          value={active_anomalies?.length || 0} valueColor="var(--danger)"
          delta={topAnomaly ? `${topAnomaly.provider} spike` : "none right now"} />
      </div>

      <div className="ov-grid">
        <div className="pcard p-aws" onClick={() => navigate("/aws")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(249,115,22,.12)" }}>☁️</div>
            <div>
              <div className="pc-name">Amazon Web Services</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(aws)}`}></span>
                {aws.anomaly?.is_anomaly ? "Anomaly detected" : `Normal · ${aws.region || "—"}`}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: "var(--aws)" }}>{fmt(aws.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(aws.month_to_date)}</div></div>
            <div><div className="pc-stat-label">vs avg</div><div className="pc-stat-val" style={{ color: aws.anomaly?.is_anomaly ? "var(--danger)" : "var(--ok)" }}>{aws.anomaly?.pct_vs_baseline != null ? `${aws.anomaly.pct_vs_baseline > 0 ? "+" : ""}${aws.anomaly.pct_vs_baseline}%` : "—"}</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={aws.daily_series} color="#f97316" /></div>
        </div>

        <div className="pcard p-runpod" onClick={() => navigate("/runpod")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(232,121,249,.12)" }}>⚡</div>
            <div>
              <div className="pc-name">RunPod</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(runpod)}`}></span>
                {runpod.anomaly?.is_anomaly ? "Anomaly · GPU spike" : "Normal"}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: runpod.anomaly?.is_anomaly ? "var(--danger)" : "var(--t1)" }}>{fmt(runpod.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(runpod.month_to_date)}</div></div>
            <div><div className="pc-stat-label">vs avg</div><div className="pc-stat-val" style={{ color: runpod.anomaly?.is_anomaly ? "var(--danger)" : "var(--ok)" }}>{runpod.anomaly?.pct_vs_baseline != null ? `${runpod.anomaly.pct_vs_baseline > 0 ? "+" : ""}${runpod.anomaly.pct_vs_baseline}%` : "—"}</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={runpod.daily_series} color="#e879f9" /></div>
        </div>

        <div className="pcard p-ga" onClick={() => navigate("/ga4")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(16,185,129,.12)" }}>📊</div>
            <div>
              <div className="pc-name">Google Analytics</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(ga4)}`}></span>
                {ga4.anomaly?.is_anomaly ? "Anomaly · event spike" : "GA4 · normal"}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Monthly</div><div className="pc-stat-val" style={{ color: "var(--ga)" }}>{fmt(ga4.monthly_license_cost)}</div></div>
            <div><div className="pc-stat-label">Events</div><div className="pc-stat-val">{ga4.events_today ? `${(ga4.events_today / 1e6).toFixed(1)}M` : "—"}</div></div>
            <div><div className="pc-stat-label">Quota</div><div className="pc-stat-val" style={{ color: "var(--ok)" }}>{ga4.quota_pct ?? "—"}%</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={ga4.daily_series} color="#10b981" /></div>
        </div>

        <div className="pcard p-gads" onClick={() => navigate("/google-ads")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(59,130,246,.12)" }}>📣</div>
            <div>
              <div className="pc-name">Google Ads</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(gads)}`}></span>
                {gads.anomaly?.is_anomaly ? "Anomaly · spend spike" : "Normal"}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: "var(--gads)" }}>{fmt(gads.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(gads.month_to_date)}</div></div>
            <div><div className="pc-stat-label">ROAS</div><div className="pc-stat-val" style={{ color: "var(--ok)" }}>{gads.roas ?? "—"}×</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={gads.daily_series} color="#3b82f6" /></div>
        </div>

        <div className="pcard p-ms" onClick={() => navigate("/ms365")} style={{ gridColumn: "span 2" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div className="pc-hdr" style={{ marginBottom: 0 }}>
              <div className="pc-icon" style={{ background: "rgba(6,182,212,.12)" }}>🪟</div>
              <div>
                <div className="pc-name">Microsoft 365</div>
                <div className="pc-status">
                  <span className={`pip ${ms365.new_ids_7d > 0 ? "pip-warn" : "pip-ok"}`}></span>
                  {ms365.new_ids_7d > 0 ? `${ms365.new_ids_7d} new IDs this week` : "Stable"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 22 }}>
              <div><div className="pc-stat-label">Users</div><div className="pc-stat-val" style={{ color: "var(--ms)" }}>{ms365.total_licenses ?? "—"}</div></div>
              <div><div className="pc-stat-label">Monthly bill</div><div className="pc-stat-val">{fmt(ms365.monthly_bill)}</div></div>
              <div><div className="pc-stat-label">New IDs (7d)</div><div className="pc-stat-val" style={{ color: "var(--warn)" }}>+{ms365.new_ids_7d ?? 0}</div></div>
              <div><div className="pc-stat-label">Cost/user</div><div className="pc-stat-val">{fmt(ms365.cost_per_user)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}