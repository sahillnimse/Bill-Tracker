import KpiCard from "../components/KpiCard";
import AnomalyHistory from "../components/AnomalyHistory";
import { useProvider } from "../hooks/useProviderData";
import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

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

  return (
    <div className="page" id="page-ms">
      <div className="ph">
        <div className="ph-title"><span style={{ color: "var(--ms)" }}>●</span> Microsoft 365</div>
        <div className="ph-sub">Licences · employee IDs · billing tracker</div>
      </div>

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

      <div className="da-grid">
        <div className="da-card" data-accent="ms">
          <div className="da-label">Premium licences</div>
          <div className="da-val" style={{ color: "var(--ms)" }}>{data.premium_count}</div>
          <div className="da-sub">{fmt(data.premium_count * 22)}/mo est.</div>
        </div>
        <div className="da-card" data-accent="teal">
          <div className="da-label">Basic licences</div>
          <div className="da-val" style={{ color: "var(--teal)" }}>{data.basic_count}</div>
          <div className="da-sub">{fmt(data.basic_count * 6)}/mo est.</div>
        </div>
        <div className="da-card" data-accent="warn">
          <div className="da-label">New IDs · 7 days</div>
          <div className="da-val" style={{ color: "var(--warn)" }}>+{data.new_ids_7d}</div>
          <div className="da-sub">{data.bill_change_vs_last_week >= 0 ? "+" : ""}{fmt(data.bill_change_vs_last_week)}/mo added cost</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Recent employee IDs</div>
          <div className="panel-stat">sorted by creation date</div>
        </div>
        {!data.recent_users?.length && <div className="empty-state">No user data available.</div>}
        {data.recent_users?.length > 0 && (
          <table className="etable">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Name</th>
                <th style={{ width: "30%" }}>Email</th>
                <th style={{ width: "22%" }}>Licence</th>
                <th style={{ width: "12%" }}>Created</th>
                <th style={{ width: "10%" }}>Cost/mo</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_users.map((u, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--t1)", fontWeight: 500 }}>{u.name}</td>
                  <td style={{ fontSize: 11, fontFamily: "var(--mono)" }}>{u.email}</td>
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