import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import AnomalyHistory from "../components/AnomalyHistory";
import Ec2InstancesPanel from "../components/Ec2InstancesPanel";
import ServiceUsagePanel from "../components/ServiceUsagePanel";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import SmaTrendCard from "../components/SmaTrendCard";
import BudgetProgressBar from "../components/BudgetProgressBar";
import MonthlyForecastCard from "../components/MonthlyForecastCard";
import SpikeAlert from "../components/SpikeAlert";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";

export default function AwsPage({ days = 30 }) {
  const { data, loading, error } = useProvider("aws", days);
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("aws").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading AWS Cost Explorer data…</div>;
  if (error) return <div className="error-state">Couldn't load AWS data: {error}</div>;
  if (!data) return null;

  const deltaPct = data.anomaly?.pct_vs_baseline;
  const deltaClass = deltaPct > 0 ? "d-up" : deltaPct < 0 ? "d-dn" : "d-flat";

  return (
    <div className="page" id="page-aws">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--aws)" }}>●</span> Amazon Web Services</div>
        <div className="ph-sub">UnblendedCost · daily granularity · {data.region}</div>
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
        <KpiCard accent="aws" label="Today" value={fmt(data.today)} valueColor="var(--aws)"
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null} deltaClass={deltaClass} />
        <KpiCard accent="aws" label="Yesterday" value={fmt(data.yesterday)} />
        <KpiCard accent="aws" label="Month to date" value={fmt(data.month_to_date)} />
        <KpiCard accent="aws" label="30-day avg/day" value={fmt(data.avg_per_day_30d)} />
      </div>
        <ExportButton data={data} filename="aws_data.json" label="Export Details" />

      <div className="da-grid">
        <div className="da-card" data-accent="aws">
          <div className="da-label">Largest service</div>
          <div className="da-val" style={{ color: "var(--aws)" }}>{data.services?.[0]?.name || "—"}</div>
          <div className="da-sub">{data.services?.[0]?.pct || 0}% of MTD spend</div>
        </div>
        <div className="da-card" data-accent="violet">
          <div className="da-label">Z-score today</div>
          <div className="da-val" style={{ color: data.anomaly?.is_anomaly ? "var(--danger)" : "var(--violet)" }}>
            {data.anomaly?.z_score ?? "—"}
          </div>
          <div className="da-sub">{data.anomaly?.is_anomaly ? `threshold exceeded` : "well within normal range"}</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Baseline mean</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{fmt(data.anomaly?.baseline_mean)}</div>
          <div className="da-sub">trailing window avg</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel panel--chart">
          <div className="panel-hdr">
            <div className="panel-title">Daily spend · {days} days</div>
            <div className="panel-stat" style={{ color: "var(--aws)" }}>avg {fmt(data.avg_per_day_30d)}/day</div>
          </div>
          <DailyBarChart series={data.daily_series} color="#f97316" highlightLast={data.anomaly?.is_anomaly} />
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Services · MTD share</div></div>
          <BreakdownPanel provider="aws" items={data.services} />
        </div>
      </div>

      <AnomalyHistory items={history} />

      <Ec2InstancesPanel />
      <ServiceUsagePanel days={days} />
    </div>
  );
}