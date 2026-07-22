import KpiCard from "../components/KpiCard";
import DailyBarChart from "../components/DailyBarChart";
import BreakdownPanel from "../components/BreakdownPanel";
import AnomalyHistory from "../components/AnomalyHistory";
import Ec2InstancesPanel from "../components/Ec2InstancesPanel";
import ServiceUsagePanel from "../components/ServiceUsagePanel";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import MonthlySpendCard from "../components/MonthlySpendCard";
import { monthToDateLabel } from "../utils/dateRangeLabel";

function formatDrivers(drivers, fmt) {
  if (!drivers?.length) return null;
  return drivers
    .map(d => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${d.pct_vs_baseline > 0 ? "+" : ""}${d.pct_vs_baseline}% vs avg)`)
    .join(", ");
}

export default function AwsPage({ days = 30, syncVersion = 0 }) {
  const { data, loading, error } = useProvider("aws", days, syncVersion);
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
  const savingsPlans = data.commitment_utilization?.savings_plans;
  const reservations = data.commitment_utilization?.reservations;

  const mtdDeltaPct = data.vs_last_month_pct;
  const mtdDelta = mtdDeltaPct != null ? `${mtdDeltaPct > 0 ? "+" : ""}${mtdDeltaPct}% vs last month` : monthToDateLabel();
  const mtdDeltaClass = mtdDeltaPct != null ? (mtdDeltaPct > 0 ? "d-up" : mtdDeltaPct < 0 ? "d-dn" : "d-flat") : "d-flat";

  return (
    <div className="page" id="page-aws">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--aws)" }}>●</span> Amazon Web Services</div>
        <div className="ph-sub">
          UnblendedCost · daily granularity · {data.region}
          {data.as_of_date && ` · as of ${data.as_of_date}`}
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

      {data.anomaly?.is_anomaly && (
        <div className="a-banner">
          <div className="a-icon">!</div>
          <div>
            <div className="a-title">AWS spend anomaly — today</div>
            <div className="a-text">
              {fmt(data.today)} today vs baseline ~{fmt(data.anomaly.baseline_mean)}/day
              ({data.anomaly.pct_vs_baseline > 0 ? "+" : ""}{data.anomaly.pct_vs_baseline}%,
              z-score {data.anomaly.z_score}).
              {formatDrivers(data.anomaly_drivers, fmt)
                ? ` Driven by: ${formatDrivers(data.anomaly_drivers, fmt)}.`
                : " Review service-level spend below."}
            </div>
          </div>
        </div>
      )}

      {data.anomaly?.is_anomaly && data.anomaly_explanation && (
        <div className="a-banner" style={{ marginTop: 8 }}>
          <div className="a-icon">i</div>
          <div>
            <div className="a-title">What does this mean?</div>
            <div className="a-text">{data.anomaly_explanation}</div>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard accent="aws" label="Today" value={fmt(data.today)} valueColor="var(--aws)"
          delta={deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}% vs avg` : null} deltaClass={deltaClass} />
        <KpiCard accent="aws" label="Yesterday" value={fmt(data.yesterday)} />
        <KpiCard accent="aws" label="Month to date" value={fmt(data.month_to_date)} delta={mtdDelta} deltaClass={mtdDeltaClass} />
        <KpiCard accent="aws" label="Forecast month-end" value={fmt(data.forecast_month_end?.amount || 0)}
          delta={data.forecast_month_end?.note || "Cost Forecast API"} deltaClass="d-flat" />
        <KpiCard accent="aws" label={`${days}-day avg/day`} value={fmt(data.avg_per_day_30d)} />
      </div>

      <div className="da-grid">
        <MonthlySpendCard providerKey="aws" accent="aws" />
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
            <div className="panel-stat" style={{ color: "var(--aws)" }}>avg {fmt(data.avg_per_day_30d)}/day ({days}d)</div>
          </div>
          <DailyBarChart series={data.daily_series} color="#f97316" highlightLast={data.anomaly?.is_anomaly} />
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Services · MTD share</div></div>
          <BreakdownPanel provider="aws" items={data.services} />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Linked accounts - MTD share</div></div>
          {data.linked_accounts?.length ? (
            <BreakdownPanel provider="aws" items={data.linked_accounts} />
          ) : (
            <div className="empty-state">{data.diagnostics?.linked_accounts || "No linked account split available."}</div>
          )}
        </div>
        <div className="panel">
          <div className="panel-hdr"><div className="panel-title">Usage types - MTD share</div></div>
          {data.usage_types?.length ? (
            <BreakdownPanel provider="aws" items={data.usage_types} />
          ) : (
            <div className="empty-state">{data.diagnostics?.usage_types || "No usage type split available."}</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Commitment utilization</div></div>
        <div className="da-grid">
          <div className="da-card" data-accent="aws">
            <div className="da-label">Savings Plans utilization</div>
            <div className="da-val" style={{ color: "var(--aws)" }}>{savingsPlans ? `${savingsPlans.utilization_pct}%` : "0%"}</div>
            <div className="da-sub">{savingsPlans ? `${fmt(savingsPlans.net_savings)} net savings` : "no active Savings Plans on this account"}</div>
          </div>
          <div className="da-card" data-accent="aws">
            <div className="da-label">On-demand equivalent cost</div>
            <div className="da-val" style={{ color: "var(--aws)" }}>{savingsPlans ? fmt(savingsPlans.on_demand_cost_equivalent) : "—"}</div>
            <div className="da-sub">what this spend would cost without any commitment</div>
          </div>
          <div className="da-card" data-accent="violet">
            <div className="da-label">Reserved Instance utilization</div>
            <div className="da-val" style={{ color: "var(--violet)" }}>{reservations ? `${reservations.utilization_pct}%` : "0%"}</div>
            <div className="da-sub">{reservations ? `${reservations.used_hours} / ${reservations.purchased_hours} hrs used` : "no active RIs on this account"}</div>
          </div>
          <div className="da-card" data-accent="violet">
            <div className="da-label">Unused reserved hours</div>
            <div className="da-val" style={{ color: reservations?.unused_hours > 0 ? "var(--danger)" : "var(--violet)" }}>
              {reservations ? reservations.unused_hours : "—"}
            </div>
            <div className="da-sub">{reservations ? "paid for but not used this period" : "no RI purchase to track"}</div>
          </div>
          <div className="da-card" data-accent="teal">
            <div className="da-label">Coverage status</div>
            <div className="da-val" style={{ color: "var(--teal)" }}>
              {!savingsPlans && !reservations ? "Pay-as-you-go" : "Mixed"}
            </div>
            <div className="da-sub">
              {data.commitment_utilization?.notes?.length
                ? data.commitment_utilization.notes.join(" · ")
                : "No Savings Plans or Reserved Instances purchased — 100% on-demand pricing."}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Waste & Inefficiency</div></div>
        {!data.low_utilization_spend?.length && <div className="empty-state">No low-utilization service spend detected.</div>}
        <div className="svc-list">
          {data.low_utilization_spend?.map((svc) => (
            <div className="svc-row" key={svc.name}>
              <span className="svc-name" title={svc.name}>{svc.name}</span>
              <div className="svc-track">
                <div className="svc-fill" style={{ width: "100%", background: "var(--danger)" }} />
              </div>
              <span className="svc-pct">usage quantity: {svc.usage}</span>
              <span className="svc-amt">{fmt(svc.cost)}</span>
            </div>
          ))}
        </div>
      </div>

      <AnomalyHistory items={history} />

      <Ec2InstancesPanel />
      <ServiceUsagePanel days={days} />
    </div>
  );
}