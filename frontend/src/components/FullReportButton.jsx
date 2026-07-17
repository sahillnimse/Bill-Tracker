import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

const ACCENT_RGB = {
    aws: [249, 115, 22],
    runpod: [232, 121, 249],
    google_ads: [59, 130, 246],
    ms365: [16, 137, 62],
    e2e: [34, 211, 238],
};

const PROVIDER_LABEL = {
    aws: "AWS",
    runpod: "RunPod",
    google_ads: "Google Ads",
    ms365: "Microsoft 365",
    e2e: "E2E Networks",
};

const DARK = [24, 28, 38];
const GREY = [110, 116, 130];
const LIGHT_GREY = [235, 237, 241];
const DANGER = [220, 38, 38];

function fmtINR(value) {
    if (value == null || value === "—") return "—";
    const num = parseFloat(value);
    if (isNaN(num)) return String(value);
    return "Rs. " + Math.round(num).toLocaleString("en-IN");
}

/* ---------- low-level drawing helpers ---------- */

function ensureSpace(doc, y, needed, margin) {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + needed > pageH - margin) {
        doc.addPage();
        return margin + 10;
    }
    return y;
}

function sectionHeading(doc, text, y, margin, pageWidth, accent) {
    y = ensureSpace(doc, y, 26, margin);
    doc.setFillColor(...accent);
    doc.rect(margin, y - 9, 3, 12, "F");
    doc.setFontSize(12.5);
    doc.setTextColor(...DARK);
    doc.setFont(undefined, "bold");
    doc.text(text, margin + 8, y);
    doc.setFont(undefined, "normal");
    y += 6;
    doc.setDrawColor(...LIGHT_GREY);
    doc.line(margin, y, pageWidth - margin, y);
    return y + 14;
}

function providerTitle(doc, label, y, margin, pageWidth, accent) {
    y = ensureSpace(doc, y, 40, margin);
    doc.setFillColor(...accent);
    doc.rect(0, y - 20, pageWidth, 28, "F");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, "bold");
    doc.text(label, margin, y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...DARK);
    return y + 22;
}

function paragraph(doc, text, y, margin, pageWidth, opts = {}) {
    if (!text) return y;
    const { fontSize = 9, color = DARK } = opts;
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    y = ensureSpace(doc, y, lines.length * 11 + 4, margin);
    doc.text(lines, margin, y);
    return y + lines.length * 11 + 8;
}

function kpiStrip(doc, items, y, margin, pageWidth, accent) {
    if (!items?.length) return y;
    const rows = items.map((i) => [i.label, i.value]);
    autoTable(doc, {
        startY: y,
        head: [["Metric", "Value"]],
        body: rows,
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 4 },
        headStyles: { fillColor: accent, textColor: [255, 255, 255], fontSize: 8.5 },
        margin: { left: margin, right: margin },
        tableWidth: pageWidth - margin * 2,
    });
    return doc.lastAutoTable.finalY + 14;
}

function dataTable(doc, head, body, y, margin, pageWidth, accent) {
    if (!body?.length) return y;
    autoTable(doc, {
        startY: y,
        head: [head],
        body,
        theme: "striped",
        styles: { fontSize: 8, cellPadding: 3.5, overflow: "linebreak" },
        headStyles: { fillColor: accent, textColor: [255, 255, 255], fontSize: 8 },
        margin: { left: margin, right: margin },
        tableWidth: pageWidth - margin * 2,
    });
    return doc.lastAutoTable.finalY + 14;
}

function drawBarChart(doc, series, y, margin, pageWidth, accent, title, fmt) {
    if (!series || series.length === 0) return y;
    const chartHeight = 65;
    y = ensureSpace(doc, y, chartHeight + 30, margin);
    const chartWidth = pageWidth - margin * 2;
    const values = series.map((d) => d.value || 0);
    const maxVal = Math.max(...values, 1);

    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(title, margin, y);
    y += 8;
    const chartTop = y;
    const barWidth = Math.max(1.5, Math.min(8, chartWidth / series.length - 1));
    const step = chartWidth / series.length;

    for (let i = 0; i < series.length; i++) {
        const barH = (values[i] / maxVal) * chartHeight;
        const x = margin + i * step + (step - barWidth) / 2;
        const yTop = chartTop + chartHeight - barH;
        const isLast = i === series.length - 1;
        doc.setFillColor(...(isLast ? DANGER : accent));
        doc.rect(x, yTop, barWidth, Math.max(barH, 0.5), "F");
    }

    doc.setDrawColor(...LIGHT_GREY);
    doc.line(margin, chartTop, margin, chartTop + chartHeight);
    doc.line(margin, chartTop + chartHeight, margin + chartWidth, chartTop + chartHeight);

    doc.setFontSize(6.5);
    doc.setTextColor(...GREY);
    doc.text("0", margin - 2, chartTop + chartHeight + 3, { align: "right" });
    doc.text(fmt ? fmt(maxVal) : String(Math.round(maxVal)), margin - 2, chartTop - 2, { align: "right" });
    const firstDate = series[0]?.date;
    const lastDate = series[series.length - 1]?.date;
    if (firstDate) doc.text(String(firstDate), margin, chartTop + chartHeight + 12);
    if (lastDate) doc.text(String(lastDate), margin + chartWidth, chartTop + chartHeight + 12, { align: "right" });

    return chartTop + chartHeight + 22;
}

function anomalySection(doc, data, y, margin, pageWidth, fmt) {
    if (!data.anomaly?.is_anomaly) return y;
    y = ensureSpace(doc, y, 50, margin);
    const boxTop = y - 10;
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(...DANGER);
    const text = data.anomaly_explanation ||
        `Today's spend of ${fmt(data.today)} is ${data.anomaly.pct_vs_baseline > 0 ? "+" : ""}${data.anomaly.pct_vs_baseline}% vs the trailing baseline of ${fmt(data.anomaly.baseline_mean)}/day (z-score ${data.anomaly.z_score}).`;
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - 16);
    const boxHeight = 22 + lines.length * 10;
    doc.roundedRect(margin, boxTop, pageWidth - margin * 2, boxHeight, 2, 2, "FD");
    doc.setFontSize(9.5);
    doc.setTextColor(...DANGER);
    doc.setFont(undefined, "bold");
    doc.text("⚠ Active Anomaly Detected", margin + 8, boxTop + 12);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...DARK);
    doc.setFontSize(8.5);
    doc.text(lines, margin + 8, boxTop + 24);
    return boxTop + boxHeight + 14;
}

function driversNote(doc, drivers, y, margin, pageWidth, fmt) {
    if (!drivers?.length) return y;
    const text = "Primary drivers: " + drivers
        .map((d) => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${d.pct_vs_baseline > 0 ? "+" : ""}${d.pct_vs_baseline}% vs avg)`)
        .join("; ") + ".";
    return paragraph(doc, text, y, margin, pageWidth, { fontSize: 8.5, color: GREY });
}

/* ---------- per-provider section builders ---------- */

function buildAwsSection(doc, data, extras, y, margin, pageWidth, accent, fmt) {
    y = anomalySection(doc, data, y, margin, pageWidth, fmt);
    y = driversNote(doc, data.anomaly_drivers, y, margin, pageWidth, fmt);

    y = sectionHeading(doc, "Key Metrics", y, margin, pageWidth, accent);
    const savingsPlans = data.commitment_utilization?.savings_plans;
    const reservations = data.commitment_utilization?.reservations;
    y = kpiStrip(doc, [
        { label: "Today", value: fmt(data.today) },
        { label: "Yesterday", value: fmt(data.yesterday) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: data.vs_last_month_pct != null ? `${data.vs_last_month_pct > 0 ? "+" : ""}${data.vs_last_month_pct}%` : "—" },
        { label: "Forecast month-end", value: data.forecast_month_end?.note ? "N/A" : fmt(data.forecast_month_end?.amount) },
        { label: "Avg/day (period)", value: fmt(data.avg_per_day_30d) },
        { label: "As of", value: data.as_of_date || "—" },
    ], y, margin, pageWidth, accent);

    y = drawBarChart(doc, data.daily_series, y, margin, pageWidth, accent, "Daily spend trend", fmt);

    y = sectionHeading(doc, "Top Services (MTD share)", y, margin, pageWidth, accent);
    y = dataTable(doc, ["Service", "% of MTD"], (data.services || []).slice(0, 10).map((s) => [s.name, `${s.pct}%`]), y, margin, pageWidth, accent);

    if (data.linked_accounts?.length) {
        y = sectionHeading(doc, "Linked Accounts (MTD share)", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Account", "% of MTD"], data.linked_accounts.slice(0, 10).map((a) => [a.name, `${a.pct}%`]), y, margin, pageWidth, accent);
    }

    if (data.usage_types?.length) {
        y = sectionHeading(doc, "Usage Types (MTD share)", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Usage Type", "% of MTD"], data.usage_types.slice(0, 10).map((u) => [u.name, `${u.pct}%`]), y, margin, pageWidth, accent);
    }

    y = sectionHeading(doc, "Commitment Utilization", y, margin, pageWidth, accent);
    y = kpiStrip(doc, [
        { label: "Savings Plans utilization", value: savingsPlans ? `${savingsPlans.utilization_pct}%` : "Unavailable" },
        { label: "Savings Plans net savings", value: savingsPlans ? fmt(savingsPlans.net_savings) : "—" },
        { label: "On-demand equivalent cost", value: savingsPlans ? fmt(savingsPlans.on_demand_cost_equivalent) : "—" },
        { label: "Reserved Instance utilization", value: reservations ? `${reservations.utilization_pct}%` : "Unavailable" },
        { label: "Unused reserved hours", value: reservations ? String(reservations.unused_hours) : "—" },
        { label: "Coverage status", value: !savingsPlans && !reservations ? "Unable to verify (see note below)" : "Mixed" },
    ], y, margin, pageWidth, accent);
    const commitmentNotes = [
        ...(data.commitment_utilization?.notes || []),
        data.forecast_month_end?.note || null,
    ].filter(Boolean);
    if (commitmentNotes.length) {
        y = paragraph(doc, commitmentNotes.join(" · "), y, margin, pageWidth, { fontSize: 8, color: GREY });
    }

    if (data.low_utilization_spend?.length) {
        y = sectionHeading(doc, "Waste & Inefficiency", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Service", "Usage Qty", "Cost"], data.low_utilization_spend.map((s) => [s.name, String(s.usage), fmt(s.cost)]), y, margin, pageWidth, accent);
    }

    const instances = extras?.instances;
    if (instances?.instances?.length) {
        y = sectionHeading(doc, `EC2 Instances (${instances.scanned_regions?.length || 0} regions scanned)`, y, margin, pageWidth, accent);
        y = kpiStrip(doc, [
            { label: "Running", value: String(instances.running_count ?? 0) },
            { label: "Stopped", value: String(instances.stopped_count ?? 0) },
        ], y, margin, pageWidth, accent);
        y = dataTable(doc, ["Instance", "Type", "Region", "State", "Uptime", "Avg CPU 24h"],
            instances.instances.map((i) => [
                i.name, i.type, i.region, i.state,
                i.uptime_hours != null ? `${(i.uptime_hours / 24).toFixed(1)}d` : "—",
                i.avg_cpu_pct_24h != null ? `${i.avg_cpu_pct_24h}%` : "—",
            ]), y, margin, pageWidth, accent);
    }

    const usage = extras?.usageBreakdown;
    if (usage?.services?.length) {
        y = sectionHeading(doc, `AWS Services In Use (${usage.active_service_count ?? usage.services.length} active)`, y, margin, pageWidth, accent);
        y = dataTable(doc, ["Service", "% share", "Total cost"],
            usage.services.map((s) => [s.service, `${s.pct}%`, fmt(s.total_cost)]),
            y, margin, pageWidth, accent);
    }
    if (usage?.regions?.length) {
        y = sectionHeading(doc, "Spend by Region", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Region", "% share", "Cost"], usage.regions.map((r) => [r.region, `${r.pct}%`, fmt(r.cost)]), y, margin, pageWidth, accent);
    }

    return y;
}

function buildRunPodSection(doc, data, y, margin, pageWidth, accent, fmt) {
    y = anomalySection(doc, data, y, margin, pageWidth, fmt);
    y = driversNote(doc, data.anomaly_drivers, y, margin, pageWidth, fmt);

    const periodTotal = (data.daily_series || []).reduce((sum, d) => sum + (d.value || 0), 0);
    y = sectionHeading(doc, "Key Metrics", y, margin, pageWidth, accent);
    y = kpiStrip(doc, [
        { label: "Today", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: data.vs_last_month_pct != null ? `${data.vs_last_month_pct > 0 ? "+" : ""}${data.vs_last_month_pct}%` : "—" },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Period total", value: fmt(periodTotal) },
        { label: "Active pods", value: String(data.active_pods_count ?? "—") },
        { label: "GPU hours today", value: `${data.gpu_hours_today ?? 0}h` },
        { label: "Savings/hr", value: fmt(data.total_savings_per_hr) },
        { label: "Spot cost/hr", value: fmt(data.spot_cost_per_hr) },
        { label: "Secure cost/hr", value: fmt(data.secure_cost_per_hr) },
        { label: "As of", value: data.as_of || "—" },
    ], y, margin, pageWidth, accent);

    y = drawBarChart(doc, data.daily_series, y, margin, pageWidth, accent, "GPU spend trend", fmt);

    if (data.pods?.length) {
        y = sectionHeading(doc, "Active Pods", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Pod", "Type", "GPU", "Cost/hr", "Est. cost"],
            data.pods.map((p) => [p.name, p.interruptible ? "Spot" : "Secure", p.gpu || "—", fmt(p.adjusted_cost_per_hr ?? p.cost_per_hr), fmt(p.estimated_cost)]),
            y, margin, pageWidth, accent);
    }

    if (data.gpu_breakdown?.length) {
        y = sectionHeading(doc, "GPU Type Cost Breakdown (pod spend)", y, margin, pageWidth, accent);
        y = dataTable(doc, ["GPU Type", "Amount", "% share"], data.gpu_breakdown.map((g) => [g.name, fmt(g.amount), `${g.pct ?? "—"}%`]), y, margin, pageWidth, accent);
    }

    if (data.endpoint_breakdown?.length) {
        y = sectionHeading(doc, "Serverless Endpoint Cost Breakdown", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Endpoint", "Amount"], data.endpoint_breakdown.map((e) => [e.name, fmt(e.amount)]), y, margin, pageWidth, accent);
    }

    if (data.possible_idle_pods?.length) {
        y = sectionHeading(doc, "Waste & Inefficiency", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Pod", "GPU", "Days running", "Cost/hr"],
            data.possible_idle_pods.map((p) => [p.name, p.gpu, String(Math.round(p.uptime_seconds / 86400)), fmt(p.cost_per_hr)]),
            y, margin, pageWidth, accent);
    }

    return y;
}

function buildGoogleAdsSection(doc, data, y, margin, pageWidth, accent, fmt) {
    y = anomalySection(doc, data, y, margin, pageWidth, fmt);
    y = driversNote(doc, data.anomaly_drivers, y, margin, pageWidth, fmt);

    y = sectionHeading(doc, "Key Metrics", y, margin, pageWidth, accent);
    y = kpiStrip(doc, [
        { label: "Today spend", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: data.vs_last_month_pct != null ? `${data.vs_last_month_pct > 0 ? "+" : ""}${data.vs_last_month_pct}%` : "—" },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Conversions (period)", value: String(data.total_conversions_period ?? 0) },
        { label: "ROAS", value: data.roas != null ? `${data.roas}x` : "—" },
        { label: "Avg CPC", value: fmt(data.avg_cpc) },
        { label: "Avg CPM", value: fmt(data.avg_cpm) },
    ], y, margin, pageWidth, accent);

    y = drawBarChart(doc, data.daily_series, y, margin, pageWidth, accent, "Daily ad spend trend", fmt);
    y = drawBarChart(doc, data.cpc_trend, y, margin, pageWidth, accent, "CPC trend", fmt);
    y = drawBarChart(doc, data.cpm_trend, y, margin, pageWidth, accent, "CPM trend", fmt);

    if (data.campaigns?.length) {
        y = sectionHeading(doc, "Campaigns (today)", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Campaign", "Amount", "% share", "ROAS"], data.campaigns.map((c) => [c.name, fmt(c.amount), `${c.pct}%`, c.roas != null ? `${c.roas}x` : "—"]), y, margin, pageWidth, accent);
    }

    if (data.network_breakdown?.length) {
        y = sectionHeading(doc, "Cost by Network", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Network", "Amount", "% share"], data.network_breakdown.map((n) => [n.name, fmt(n.amount), `${n.pct}%`]), y, margin, pageWidth, accent);
    }

    if (data.wasted_spend?.length) {
        y = sectionHeading(doc, "Wasted Spend (zero conversions)", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Campaign", "Clicks", "Amount"], data.wasted_spend.map((c) => [c.name, String(c.clicks), fmt(c.amount)]), y, margin, pageWidth, accent);
    }

    if (data.rank_loss?.length) {
        y = sectionHeading(doc, "Rank / Budget Loss", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Campaign", "Rank lost %", "Amount"], data.rank_loss.map((c) => [c.name, `${c.rank_lost_pct}%`, fmt(c.amount)]), y, margin, pageWidth, accent);
    }

    return y;
}

function buildMs365Section(doc, data, y, margin, pageWidth, accent) {
    const fmt = fmtINR;
    y = sectionHeading(doc, "Key Metrics", y, margin, pageWidth, accent);
    y = kpiStrip(doc, [
        { label: "Total licences", value: String(data.total_licenses ?? "—") },
        { label: "Monthly bill", value: fmt(data.monthly_bill) },
        { label: "Bill change vs last week", value: data.bill_change_vs_last_week != null ? fmt(data.bill_change_vs_last_week) : "—" },
        { label: "Cost per user", value: fmt(data.cost_per_user) },
        { label: "MFA pending", value: String(data.mfa_pending ?? 0) },
        { label: "Standard licences", value: String(data.standard_count ?? 0) },
        { label: "Basic licences", value: String(data.basic_count ?? 0) },
        { label: "Free / trial seats", value: String(data.free_count ?? 0) },
        { label: "New IDs (7d)", value: `${(data.new_ids_7d ?? 0) > 0 ? "+" : ""}${data.new_ids_7d ?? 0}` },
        { label: "Inactive licensed seats", value: String(data.inactive_licensed_count ?? 0) },
        { label: "Inactive monthly waste", value: data.sign_in_activity_available ? fmt(data.inactive_monthly_waste) : "sign-in data unavailable" },
    ], y, margin, pageWidth, accent);

    if (data.license_trend?.length) {
        const chartSeries = data.license_trend.map((row) => ({ date: row.date, value: row.monthly_bill }));
        y = drawBarChart(doc, chartSeries, y, margin, pageWidth, accent, "Monthly bill trend", fmt);
    }

    if (data.recent_users?.length) {
        y = sectionHeading(doc, "Employee IDs", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Name", "Email", "Licence", "Created", "Cost/mo"],
            data.recent_users.slice(0, 40).map((u) => [u.name, u.email, u.license, u.created, fmt(u.cost)]),
            y, margin, pageWidth, accent);
    }

    if (data.sign_in_activity_available && data.inactive_licensed_users?.length) {
        y = sectionHeading(doc, "Inactive Licensed Seats", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Name", "Email", "Licence", "Last sign-in", "Cost/mo"],
            data.inactive_licensed_users.slice(0, 40).map((u) => [u.name, u.email, u.license, u.last_sign_in || "never", fmt(u.cost)]),
            y, margin, pageWidth, accent);
    } else if (!data.sign_in_activity_available) {
        y = paragraph(doc, "Inactive seat detection unavailable — requires AuditLog.Read.All permission on the Azure AD app registration to check sign-in activity.", y, margin, pageWidth, { fontSize: 8.5, color: GREY });
    }

    if (data.license_trend?.length) {
        y = sectionHeading(doc, "License Trend Snapshots", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Date", "Total", "Standard", "Basic", "Monthly bill"],
            data.license_trend.slice(0, 30).map((r) => [r.date, String(r.total_licenses), String(r.standard_count), String(r.basic_count), fmt(r.monthly_bill)]),
            y, margin, pageWidth, accent);
    }

    return y;
}

function buildE2eSection(doc, data, y, margin, pageWidth, accent) {
    const fmt = fmtINR;
    y = anomalySection(doc, data, y, margin, pageWidth, fmt);
    y = driversNote(doc, data.anomaly_drivers, y, margin, pageWidth, fmt);

    const periodTotal = (data.daily_series || []).reduce((sum, d) => sum + (d.value || 0), 0);
    y = sectionHeading(doc, "Key Metrics", y, margin, pageWidth, accent);
    y = kpiStrip(doc, [
        { label: "Today", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: data.vs_last_month_pct != null ? `${data.vs_last_month_pct > 0 ? "+" : ""}${data.vs_last_month_pct}%` : "—" },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Period total", value: fmt(periodTotal) },
        { label: "Active nodes", value: String(data.active_nodes_count ?? "—") },
        { label: "GPU hours today", value: `${(data.gpu_hours_today || 0).toFixed(1)}h` },
        { label: "CPU hours today", value: `${(data.cpu_hours_today || 0).toFixed(1)}h` },
        { label: "Free tier hrs remaining", value: `${(data.free_tier_hours_remaining || 0).toFixed(1)}h` },
        { label: "As of", value: data.as_of || "—" },
    ], y, margin, pageWidth, accent);

    y = drawBarChart(doc, data.daily_series, y, margin, pageWidth, accent, "Node spend trend", fmt);

    if (data.nodes?.length) {
        y = sectionHeading(doc, "Active Nodes", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Node", "Plan", "GPU", "Status", "Cost/hr"],
            data.nodes.map((n) => [n.name, n.plan || "—", n.gpu || "—", n.status, fmt(n.cost_per_hr)]),
            y, margin, pageWidth, accent);
    }

    if (data.historical_spikes?.length) {
        y = sectionHeading(doc, "Spend Spikes Analyzer", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Date", "Spike %", "Top Driver", "Value", "Baseline"],
            data.historical_spikes.map((s) => [s.date, `+${s.pct_increase}%`, s.top_driver, fmt(s.value), fmt(s.baseline_mean)]),
            y, margin, pageWidth, accent);
    }

    if (data.node_breakdown?.length) {
        y = sectionHeading(doc, "SKU / Node Type Cost Breakdown", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Node Type", "Amount", "% share"], data.node_breakdown.map((n) => [n.name, fmt(n.amount), `${n.pct ?? "—"}%`]), y, margin, pageWidth, accent);
    }

    if (data.possible_idle_nodes?.length) {
        y = sectionHeading(doc, "Waste & Inefficiency", y, margin, pageWidth, accent);
        y = dataTable(doc, ["Node", "GPU", "Days running", "Cost/hr"],
            data.possible_idle_nodes.map((n) => [n.name, n.gpu, String(Math.round(n.uptime_seconds / 86400)), fmt(n.cost_per_hr)]),
            y, margin, pageWidth, accent);
    }

    return y;
}

function footer(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7.5);
        doc.setTextColor(...GREY);
        doc.text("SpendWatch · Full Spend Report", 20, pageHeight - 14);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - 20, pageHeight - 14, { align: "right" });
    }
}

function coverPage(doc, overview, margin, pageWidth, fmt) {
    let y = margin + 10;
    doc.setFillColor(...DARK);
    doc.rect(0, 0, pageWidth, 8, "F");
    y += 26;
    doc.setFontSize(24);
    doc.setTextColor(...DARK);
    doc.setFont(undefined, "bold");
    doc.text("SpendWatch — Full Cloud Spend Report", margin, y);
    doc.setFont(undefined, "normal");
    y += 18;
    doc.setFontSize(10);
    doc.setTextColor(...GREY);
    doc.text("Generated " + new Date().toLocaleString(), margin, y);
    y += 24;

    const { today_total, month_to_date_total, projected_month_end, active_anomalies } = overview || {};
    y = kpiStrip(doc, [
        { label: "Today (all providers)", value: fmt(today_total) },
        { label: "Month to date (all providers)", value: fmt(month_to_date_total) },
        { label: "Projected month-end", value: fmt(projected_month_end) },
        { label: "Active anomalies", value: String(active_anomalies?.length ?? 0) },
    ], y, margin, pageWidth, DARK);

    y += 6;
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.setFont(undefined, "bold");
    doc.text("Contents", margin, y);
    doc.setFont(undefined, "normal");
    y += 16;
    doc.setFontSize(9.5);
    Object.entries(PROVIDER_LABEL).forEach(([key, label]) => {
        doc.setFillColor(...ACCENT_RGB[key]);
        doc.circle(margin + 3, y - 3, 2.5, "F");
        doc.setTextColor(...DARK);
        doc.text(label, margin + 12, y);
        y += 16;
    });

    return y;
}

const SECTION_BUILDERS = {
    aws: (doc, data, y, margin, pageWidth, accent, fmt, extras) => buildAwsSection(doc, data, extras, y, margin, pageWidth, accent, fmt),
    runpod: (doc, data, y, margin, pageWidth, accent, fmt) => buildRunPodSection(doc, data, y, margin, pageWidth, accent, fmt),
    google_ads: (doc, data, y, margin, pageWidth, accent, fmt) => buildGoogleAdsSection(doc, data, y, margin, pageWidth, accent, fmt),
    ms365: (doc, data, y, margin, pageWidth, accent) => buildMs365Section(doc, data, y, margin, pageWidth, accent),
    e2e: (doc, data, y, margin, pageWidth, accent) => buildE2eSection(doc, data, y, margin, pageWidth, accent),
};

/* ---------- main component ---------- */

export default function FullReportButton({ overview, label = "Export Full Report" }) {
    const { fmt: currencyFmt } = useCurrency();
    const fmt = (v) => {
        const s = currencyFmt(v);
        return typeof s === "string" ? s.replace("₹", "Rs. ") : s;
    };
    const [loading, setLoading] = useState(false);

    const handleExport = async () => {
        if (!overview?.providers) return;
        setLoading(true);
        try {
            let awsExtras = {};
            try {
                const [instances, usageBreakdown] = await Promise.all([
                    api.getAwsInstances().catch(() => null),
                    api.getAwsUsageBreakdown(30).catch(() => null),
                ]);
                awsExtras = { instances, usageBreakdown };
            } catch {
                awsExtras = {};
            }

            const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 36;

            let y = coverPage(doc, overview, margin, pageWidth, fmt);

            const order = ["aws", "runpod", "google_ads", "ms365", "e2e"];
            for (const key of order) {
                const data = overview.providers?.[key];
                if (!data) continue;
                const accent = ACCENT_RGB[key];

                doc.addPage();
                y = providerTitle(doc, PROVIDER_LABEL[key], margin + 10, margin, pageWidth, accent);

                const builder = SECTION_BUILDERS[key];
                const providerFmt = key === "ms365" || key === "e2e" ? fmtINR : fmt;
                y = builder(doc, data, y, margin, pageWidth, accent, providerFmt, awsExtras);
            }

            footer(doc);
            doc.save(`spendwatch_full_report_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (e) {
            console.error("Full report export failed", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button className="export-btn" onClick={handleExport} disabled={loading} title="Download full spend report as PDF">
            {loading ? "Generating…" : label}
        </button>
    );
}