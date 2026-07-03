import KpiCard from "../components/KpiCard";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";
import ExportButton from "../components/ExportButton";

export default function Microsoft365Page() {
  const { data, loading, error } = useProvider("ms365");
  const [history, setHistory] = useState([]);
  const { fmt } = useCurrency();

  useEffect(() => {
    api.getAnomalies("ms365").then(setHistory).catch(() => { });
  }, []);

  if (loading) return <div className="loading-state">Loading Microsoft 365 / Graph data…</div>;
  if (error) return <div className="error-state">Couldn't load Microsoft 365 data: {error}</div>;
  if (!data) return null;

  // Derive per-tier monthly cost from the users actually on that tier, rather
  // than hardcoding a price here — avoids this page drifting out of sync with
  // the backend's real pricing config (see MS365_STANDARD_LICENSE_COST /
  // MS365_BASIC_LICENSE_COST in backend/.env). Values are USD; the $/₹ toggle
  // (CurrencyContext) converts live for display.
  const standardUnitCost = data.recent_users?.find((u) => u.license === "Business Standard")?.cost ?? 0;
  const basicUnitCost = data.recent_users?.find((u) => u.license === "Business Basic")?.cost ?? 0;

  return (
    <div className="page" id="page-ms">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--ms)" }}>●</span> Microsoft 365</div>
        <div className="ph-sub">Licences · employee IDs · billing tracker</div>
        <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>
          ⓘ Time range selector doesn't apply here — this page shows current licence and billing snapshot, not historical daily data.
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
        <KpiCard accent="ms" label="Total licences" value={data.total_licenses} valueColor="var(--ms)"
          delta={data.new_ids_7d ? `+${data.new_ids_7d} this week` : null} deltaClass="d-up" />
        <KpiCard accent="ms" label="Monthly bill" value={fmt(data.monthly_bill)}
          delta={data.bill_change_vs_last_week ? `${data.bill_change_vs_last_week > 0 ? "+" : ""}${fmt(data.bill_change_vs_last_week)} vs last wk` : null}
          deltaClass={data.bill_change_vs_last_week > 0 ? "d-up" : "d-flat"} />
        <KpiCard accent="ms" label="Cost per user" value={fmt(data.cost_per_user)} delta="blended avg" deltaClass="d-flat" />
        <KpiCard accent="ms" label="MFA pending" value={data.mfa_pending} valueColor={data.mfa_pending > 0 ? "var(--warn)" : undefined}
          delta={data.mfa_pending > 0 ? "security risk" : "all enrolled"} deltaClass={data.mfa_pending > 0 ? "d-up" : "d-flat"} />
      </div>
      <ExportButton data={data} filename="ms365_data.json" label="Export Details" />

      <div className="da-grid">
        <div className="da-card" data-accent="ms">
          <div className="da-label">Standard licences</div>
          <div className="da-val" style={{ color: "var(--ms)" }}>{data.standard_count}</div>
          <div className="da-sub">{fmt(data.standard_count * (data.standard_cost_per_user || 14))}/mo est.</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Business Basic licences</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{data.basic_count}</div>
          <div className="da-sub">{fmt(data.basic_count * (data.basic_cost_per_user || 7))}/mo est.</div>
        </div>
        <div className="da-card" data-accent="t3">
          <div className="da-label">Free / trial seats</div>
          <div className="da-val" style={{ color: "var(--t3)" }}>{data.free_count}</div>
          <div className="da-sub">not billed</div>
        </div>
        <div className="da-card" data-accent="warn">
          <div className="da-label">New IDs · 7 days</div>
          <div className="da-val" style={{ color: "var(--warn)" }}>+{data.new_ids_7d}</div>
          <div className="da-sub">{data.bill_change_vs_last_week >= 0 ? "+" : ""}{fmt(data.bill_change_vs_last_week)}/mo added cost</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Employee IDs</div>
          <div className="panel-stat">sorted by creation date · {data.recent_users?.length ?? 0} total</div>
        </div>
        {!data.recent_users?.length && <div className="empty-state">No user data available.</div>}
        {data.recent_users?.length > 0 && (
          <table className="etable">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Name</th>
                <th style={{ width: "24%" }}>Email</th>
                <th style={{ width: "16%" }}>Title</th>
                <th style={{ width: "16%" }}>Licence</th>
                <th style={{ width: "12%" }}>Created</th>
                <th style={{ width: "10%" }}>Cost/mo</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_users.map((u, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--t1)", fontWeight: 500 }}>{u.name}</td>
                  <td style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{u.email}</td>
                  <td style={{ fontSize: 11 }}>{u.title}</td>
                  <td>{u.license}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{u.created}</td>
                  <td style={{ fontFamily: "var(--mono)" }}>{fmt(u.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnomalyHistory items={history} />
    </div>
  );
}