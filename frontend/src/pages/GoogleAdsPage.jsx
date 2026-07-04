import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";

const CAMPAIGN_COLORS = ["var(--gads)", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe"];

export default function GoogleAdsPage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("google_ads", days, syncVersion);
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("google_ads").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading Google Ads data...</div>;
  if (error) return <div className="error-state">Couldn't load Google Ads data: {error}</div>;
  if (!data) return null;

  const isAnomaly = data.anomaly?.is_anomaly;
  const bestCampaign = data.campaigns?.length
    ? [...data.campaigns].sort((a, b) => b.roas - a.roas)[0]
    : null;

  return (
    <div className="page" id="page-gads">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--gads)" }}>Google Ads</span></div>
        <div className="ph-sub">Campaign spend - budget pacing - ROAS tracking</div>
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
        <KpiCard accent="gads" label="Today spend" value={fmt(data.today)} valueColor="var(--gads)"
          delta={isAnomaly ? `${data.anomaly.pct_vs_baseline > 0 ? "+" : ""}${data.anomaly.pct_vs_baseline}% vs avg` : null}
          deltaClass={isAnomaly ? "d-up" : "d-flat"} />
        <KpiCard accent="gads" label="Month to date" value={fmt(data.month_to_date)} />
        <KpiCard accent="gads" label="ROAS (30d)" value={`${data.roas}x`} valueColor="var(--ok)" />
        <KpiCard accent="gads" label="Avg CPC (30d)" value={fmt(data.avg_cpc || 0)}
          delta={`CPM ${fmt(data.avg_cpm || 0)}`} deltaClass="d-flat" />
      </div>
      <ExportButton data={data} filename="google_ads_data.json" label="Export Details" />

      <div className="da-grid">
        <div className="da-card" data-accent="gads">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: isAnomaly ? "var(--danger)" : "var(--gads)" }}>{data.anomaly?.z_score ?? "-"}</div>
          <div className="da-sub">vs trailing baseline</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Wasted spend</div>
          <div className="da-val" style={{ color: data.wasted_spend?.length ? "var(--warn)" : "var(--teal)" }}>{data.wasted_spend?.length || 0}</div>
          <div className="da-sub">campaigns with cost and zero conversions</div>
        </div>
        <div className="da-card" data-accent="pink">
          <div className="da-label">Best campaign</div>
          <div className="da-val" style={{ color: "var(--pink)" }}>{bestCampaign?.name || "-"}</div>
          <div className="da-sub">{bestCampaign ? `ROAS ${bestCampaign.roas}x - ${fmt(bestCampaign.amount)}` : "-"}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Daily ad spend - {days} days</div></div>
          <DailyBarChart series={data.daily_series} color="#3b82f6" highlightLast={isAnomaly} />
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Campaigns - today</div></div>
          {!data.campaigns?.length && <div className="empty-state">No campaign spend recorded today.</div>}
          <div className="svc-list">
            {data.campaigns?.map((c, i) => (
              <div className="svc-row" key={c.name}>
                <span className="svc-name">{c.name}</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: `${Math.max(c.pct, 2)}%`, background: CAMPAIGN_COLORS[i] || CAMPAIGN_COLORS[4], animationDelay: `${i * 0.07}s` }} />
                </div>
                <span className="svc-pct" style={{ color: CAMPAIGN_COLORS[i] || CAMPAIGN_COLORS[4] }}>{c.pct}%</span>
                <span className="svc-amt">{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Cost by network - 30 days</div></div>
          {!data.network_breakdown?.length && <div className="empty-state">{data.diagnostics?.network_breakdown || "No network split available."}</div>}
          <div className="svc-list">
            {data.network_breakdown?.map((n, i) => (
              <div className="svc-row" key={n.name}>
                <span className="svc-name">{n.name}</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: `${Math.max(n.pct, 2)}%`, background: CAMPAIGN_COLORS[i] || CAMPAIGN_COLORS[4] }} />
                </div>
                <span className="svc-pct">{n.pct}%</span>
                <span className="svc-amt">{fmt(n.amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">CPC trend - 30 days</div></div>
          <DailyBarChart series={data.cpc_trend || []} color="#60a5fa" />
          <div className="panel-stat" style={{ marginTop: 10 }}>Avg CPC {fmt(data.avg_cpc || 0)} - Avg CPM {fmt(data.avg_cpm || 0)}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Wasted spend - 30 days</div></div>
          {!data.wasted_spend?.length && <div className="empty-state">{data.diagnostics?.wasted_spend || "No zero-conversion spend found."}</div>}
          <div className="svc-list">
            {data.wasted_spend?.map((c) => (
              <div className="svc-row" key={c.name}>
                <span className="svc-name" title={c.name}>{c.name}</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: "100%", background: "var(--warn)" }} />
                </div>
                <span className="svc-pct">{c.clicks} clicks</span>
                <span className="svc-amt">{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Rank / budget loss</div></div>
          {!data.rank_loss?.length && <div className="empty-state">{data.diagnostics?.rank_loss || "No rank or budget loss data available."}</div>}
          <div className="svc-list">
            {data.rank_loss?.map((c) => (
              <div className="svc-row" key={c.name}>
                <span className="svc-name" title={c.name}>{c.name}</span>
                <div className="svc-track">
                  <div className="svc-fill" style={{ width: `${Math.max(c.rank_lost_pct, 2)}%`, background: "var(--pink)" }} />
                </div>
                <span className="svc-pct">{c.rank_lost_pct}%</span>
                <span className="svc-amt">{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}
