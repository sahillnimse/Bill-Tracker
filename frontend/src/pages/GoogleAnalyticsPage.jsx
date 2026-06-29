import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

export default function GoogleAnalyticsPage() {
  const { data, loading, error } = useProvider("ga4");
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("ga4").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading Google Analytics data…</div>;
  if (error) return <div className="error-state">Couldn't load GA4 data: {error}</div>;
  if (!data) return null;

  const isAnomaly = data.anomaly?.is_anomaly;

  return (
    <div className="page" id="page-ga">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--ga)" }}>●</span> Google Analytics</div>
        <div className="ph-sub">GA4 · usage, events and licence tracking</div>
      </div>

      <div className="kpi-grid">
        <KpiCard accent="ga" label="Monthly licence" value={fmt(data.monthly_license_cost)} valueColor="var(--ga)" />
        <KpiCard accent="ga" label="Events today" value={data.events_today ? `${(data.events_today / 1e6).toFixed(1)}M` : "—"}
          delta={isAnomaly ? `${data.anomaly.pct_vs_baseline > 0 ? "+" : ""}${data.anomaly.pct_vs_baseline}% vs avg` : null}
          deltaClass={isAnomaly ? "d-up" : "d-flat"} />
        <KpiCard accent="ga" label="Quota used (10M/mo ref)" value={`${data.quota_pct}%`}
          delta={data.quota_pct < 70 ? "safe margin" : "approaching limit"}
          deltaClass={data.quota_pct < 70 ? undefined : "d-up"} />
        <KpiCard accent="ga" label="Active platforms" value={data.active_platforms} />
      </div>

      <div className="da-grid">
        <div className="da-card" data-accent="ga">
          <div className="da-label">Avg events/day</div>
          <div className="da-val" style={{ color: "var(--ga)" }}>{data.avg_events_per_day ? `${(data.avg_events_per_day / 1e6).toFixed(2)}M` : "—"}</div>
          <div className="da-sub">trailing 30 days</div>
        </div>
        <div className="da-card" data-accent="violet">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: isAnomaly ? "var(--danger)" : "var(--violet)" }}>{data.anomaly?.z_score ?? "—"}</div>
          <div className="da-sub">event-volume basis</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Top platform</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{data.platforms?.[0]?.name || "—"}</div>
          <div className="da-sub">{data.platforms?.[0]?.pct || 0}% of events</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Daily event volume · 30 days</div>
            <div className="panel-stat" style={{ color: "var(--t3)" }}>events</div>
          </div>
          <DailyBarChart series={data.daily_series} color="#10b981" highlightLast={isAnomaly} />
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Properties breakdown</div></div>
          <BreakdownPanel provider="ga4" items={data.platforms?.map((p) => ({ ...p, amount: p.events }))} unit="events" />
        </div>
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}