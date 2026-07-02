import { useEffect, useState } from "react";
import api from "../api/client";

/**
 * Live EC2 instance tracker: shows how many VMs are running, their type,
 * region, uptime, and 24h average CPU utilization (real CloudWatch data),
 * sorted so the most-utilized running instances appear first.
 */
export default function Ec2InstancesPanel() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        api
            .getAwsInstances()
            .then(setData)
            .catch((err) => setError(err?.response?.data?.detail || err.message))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">EC2 instances</div>
                </div>
                <div className="loading-state">Scanning regions for running instances…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">EC2 instances</div>
                </div>
                <div className="error-state">
                    Couldn't load EC2 data: {error}
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--t3)" }}>
                        This needs ec2:DescribeInstances, ec2:DescribeRegions, and
                        cloudwatch:GetMetricData permissions on your AWS IAM user, in
                        addition to the existing Cost Explorer permission.
                    </div>
                </div>
            </div>
        );
    }

    if (!data || data.total_count === 0) {
        return (
            <div className="panel" data-accent="aws">
                <div className="panel-hdr">
                    <div className="panel-title">EC2 instances</div>
                </div>
                <div className="empty-state">No EC2 instances found across {data?.scanned_regions?.length || 0} scanned regions.</div>
            </div>
        );
    }

    const stateColor = (state) => {
        if (state === "running") return "var(--teal)";
        if (state === "stopped") return "var(--t3)";
        return "var(--danger)";
    };

    return (
        <div className="panel" data-accent="aws">
            <div className="panel-hdr">
                <div className="panel-title">EC2 instances · {data.scanned_regions.length} regions scanned</div>
                <div className="panel-stat" style={{ color: "var(--aws)" }}>
                    {data.running_count} running · {data.stopped_count} stopped
                </div>
            </div>

            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: "left", color: "var(--t3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            <th style={{ padding: "6px 8px" }}>Instance</th>
                            <th style={{ padding: "6px 8px" }}>Type</th>
                            <th style={{ padding: "6px 8px" }}>Region</th>
                            <th style={{ padding: "6px 8px" }}>State</th>
                            <th style={{ padding: "6px 8px" }}>Uptime</th>
                            <th style={{ padding: "6px 8px" }}>Avg CPU (24h)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.instances.map((inst) => (
                            <tr key={inst.id} style={{ borderTop: "1px solid var(--b1)" }}>
                                <td style={{ padding: "8px" }}>
                                    <div style={{ fontWeight: 600 }}>{inst.name}</div>
                                    <div style={{ fontSize: 11, color: "var(--t3)", fontFamily: "var(--mono)" }}>{inst.id}</div>
                                </td>
                                <td style={{ padding: "8px", fontFamily: "var(--mono)" }}>{inst.type}</td>
                                <td style={{ padding: "8px" }}>{inst.region}</td>
                                <td style={{ padding: "8px" }}>
                                    <span style={{ color: stateColor(inst.state), fontWeight: 600, textTransform: "capitalize" }}>
                                        {inst.state}
                                    </span>
                                </td>
                                <td style={{ padding: "8px" }}>
                                    {inst.uptime_hours != null ? `${(inst.uptime_hours / 24).toFixed(1)}d` : "—"}
                                </td>
                                <td style={{ padding: "8px" }}>
                                    {inst.avg_cpu_pct_24h != null ? (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{ width: 60, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                                <div
                                                    style={{
                                                        width: `${Math.min(inst.avg_cpu_pct_24h, 100)}%`,
                                                        height: "100%",
                                                        background: inst.avg_cpu_pct_24h > 70 ? "var(--danger)" : inst.avg_cpu_pct_24h > 30 ? "var(--aws)" : "var(--teal)",
                                                    }}
                                                />
                                            </div>
                                            <span>{inst.avg_cpu_pct_24h}%</span>
                                        </div>
                                    ) : (
                                        "—"
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {data.by_type.length > 0 && (
                <div style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <div>
                        <div style={{ fontSize: 11, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                            By instance type
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {data.by_type.map((t) => (
                                <span key={t.type} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(249,115,22,0.1)", color: "var(--aws)" }}>
                                    {t.type} × {t.count}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}