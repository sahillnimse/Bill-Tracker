import { useEffect, useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

/**
 * Deep breakdown of which AWS services and specific usage types are
 * actively driving spend, plus a region split — all pulled live from
 * Cost Explorer (real data, not estimated).
 */
export default function ServiceUsagePanel({ days = 30 }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);
    const { fmt } = useCurrency();

    useEffect(() => {
        setLoading(true);
        api
            .getAwsUsageBreakdown(days)
            .then(setData)
            .catch((err) => setError(err?.response?.data?.detail || err.message))
            .finally(() => setLoading(false));
    }, [days]);

    if (loading) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">AWS services in use</div>
                </div>
                <div className="loading-state">Querying Cost Explorer for usage detail…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">AWS services in use</div>
                </div>
                <div className="error-state">Couldn't load usage breakdown: {error}</div>
            </div>
        );
    }

    if (!data || data.services.length === 0) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">AWS services in use</div>
                </div>
                <div className="empty-state">No service usage found in the last {days} days.</div>
            </div>
        );
    }

    return (
        <div className="panel" data-accent="aws">
            <div className="panel-hdr">
                <div className="panel-title">AWS services in use · {days} days</div>
                <div className="panel-stat" style={{ color: "var(--aws)" }}>
                    {data.active_service_count} active services
                </div>
            </div>

            <div>
                {data.services.map((svc) => {
                    const isOpen = expanded === svc.service;
                    return (
                        <div key={svc.service} style={{ borderBottom: "1px solid var(--b1)" }}>
                            <div
                                onClick={() => setExpanded(isOpen ? null : svc.service)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "10px 4px",
                                    cursor: "pointer",
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 11, color: "var(--t3)", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>
                                        ▸
                                    </span>
                                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {svc.service}
                                    </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13 }}>
                                    <span style={{ color: "var(--aws)" }}>{svc.pct}%</span>
                                    <span style={{ fontFamily: "var(--mono)", minWidth: 80, textAlign: "right" }}>{fmt(svc.total_cost)}</span>
                                </div>
                            </div>

                            {isOpen && (
                                <div style={{ padding: "0 4px 12px 24px" }}>
                                    {svc.usage_types.map((u) => (
                                        <div
                                            key={u.usage_type}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                fontSize: 12,
                                                color: "var(--t2)",
                                                padding: "4px 0",
                                            }}
                                        >
                                            <span style={{ fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>
                                                {u.usage_type}
                                            </span>
                                            <span style={{ flexShrink: 0 }}>{fmt(u.cost)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {data.regions.length > 0 && (
                <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                        Spend by region
                    </div>
                    {data.regions.map((r) => (
                        <div key={r.region} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <span style={{ fontSize: 12, width: 110, flexShrink: 0 }}>{r.region}</span>
                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                <div style={{ width: `${Math.max(r.pct, 2)}%`, height: "100%", background: "var(--aws)" }} />
                            </div>
                            <span style={{ fontSize: 12, color: "var(--t3)", width: 70, textAlign: "right" }}>{r.pct}%</span>
                            <span style={{ fontSize: 12, fontFamily: "var(--mono)", width: 80, textAlign: "right" }}>{fmt(r.cost)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}