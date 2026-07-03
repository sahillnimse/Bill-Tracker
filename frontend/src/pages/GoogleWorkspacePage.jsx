import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";

export default function GoogleWorkspacePage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("gworkspace", days, syncVersion);
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("gworkspace").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading Google Workspace data…</div>;
  if (error) return <div className="error-state">Couldn't load Workspace data: {error}</div>;
  if (!data) return null;

  const deltaPct = data.anomaly?.pct_vs_baseline;
  const deltaClass = deltaPct > 0 ? "d-up" : deltaPct < 0 ? "d-dn" : "d-flat";

  return (
    <div className="page" id="page-gworkspace">
      <div className="ph">
        <div className="ph-title">
          <span style={{ color: "var(--ga)" }}>●</span> Google Workspace
        </div>
        <div className="ph-sub">
          Admin SDK Reports · Drive activity + storage · {data.domain}
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

      <div className="kpi-grid">
        <KpiCard accent="ga" label="Monthly cost"
          value={fmt(data.monthly_cost)} valueColor="var(--ga)"
          delta={`${data.seats} seats × ${fmt(data.cost_per_seat)}`} deltaClass="d-flat" />
        <KpiCard accent="ga" label="Active users" value={data.active_users} />
        <KpiCard accent="ga" label="Storage used" value={`${data.total_storage_gb} GB`} />
        <KpiCard accent="ga" label="Drive events today"
          value={data.drive_events_today}
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null}
          deltaClass={deltaClass} />
      </div>
      <ExportButton data={data} filename="google_workspace_data.json" label="Export Details" />

      <div className="da-grid">
        <div className="da-card" data-accent="ga">
          <div className="da-label">Cost per seat</div>
          <div className="da-val" style={{ color: "var(--ga)" }}>{fmt(data.cost_per_seat)}</div>
          <div className="da-sub">per user / month</div>
        </div>
        <div className="da-card" data-accent="violet">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: data.anomaly?.is_anomaly ? "var(--danger)" : "var(--violet)" }}>
            {data.anomaly?.z_score ?? "—"}
          </div>
          <div className="da-sub">{data.anomaly?.is_anomaly ? "activity spike detected" : "normal activity range"}</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Cost per GB</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{fmt(data.cost_per_gb)}</div>
          <div className="da-sub">estimated storage efficiency</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Drive activity · {days} days</div>
            <div className="panel-stat" style={{ color: "var(--ga)" }}>
              avg {data.avg_drive_events_per_day} events/day
            </div>
          </div>
          <DailyBarChart series={data.daily_series} color="#10b981" highlightLast={data.anomaly?.is_anomaly} />
        </div>

        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Top users by storage</div>
          </div>
          <div className="svc-list">
            {(data.top_users || []).slice(0, 6).map((u, i) => {
              const maxGb = data.top_users?.[0]?.storage_gb || 1;
              const pct = Math.round((u.storage_gb / maxGb) * 100);
              return (
                <div key={i} className="svc-row">
                  <div className="svc-name" title={u.email}>{u.email}</div>
                  <div className="svc-track">
                    <div className="svc-fill" style={{ width: `${pct}%`, background: "var(--ga)" }} />
                  </div>
                  <div className="svc-amt">{u.storage_gb} GB</div>
                </div>
              );
            })}
            {(!data.top_users || data.top_users.length === 0) && (
              <div style={{ color: "var(--t3)", fontSize: 12 }}>
                No user data yet — Reports API may have a 2-day lag.
              </div>
            )}
          </div>
        </div>
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}