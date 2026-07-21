import { useState } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

/* ============================================================
   SpendWatch — Full Report (restructured)
   - Dark branded cover with hero KPI cards
   - Numbered sections + clickable Table of Contents w/ page nos
   - Running header with provider name on every page
   - Each provider ALWAYS starts on a fresh page with a banner
   - 2-column KPI grid (cards) instead of long metric tables
   - Charts: gridlines, y-axis ticks, dashed 30d-average line
   - Tables: zebra rows, right-aligned numeric columns, capped rows
   - Anomaly callout with severity chip
   - Explicit "no data" placeholders instead of blank space
   ============================================================ */

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

const DARK = [17, 21, 31];
const INK = [30, 36, 48];
const GREY = [110, 116, 130];
const FAINT = [160, 166, 178];
const LIGHT = [242, 244, 247];
const LINE = [225, 228, 234];
const DANGER = [220, 38, 38];
const DANGER_BG = [254, 242, 242];
const OK = [22, 163, 74];

const PAGE_MARGIN = 40;
const HEADER_H = 26;

function fmtINR(value) {
    if (value == null || value === "—") return "—";
    const num = parseFloat(value);
    if (isNaN(num)) return String(value);
    return "Rs. " + Math.round(num).toLocaleString("en-IN");
}

function pctStr(v) {
    if (v == null) return "—";
    return `${v > 0 ? "+" : ""}${v}%`;
}

/* ---------------- layout state ---------------- */

function makeCtx(doc) {
    return {
        doc,
        pageWidth: doc.internal.pageSize.getWidth(),
        pageHeight: doc.internal.pageSize.getHeight(),
        margin: PAGE_MARGIN,
        currentProvider: null, // for running header
        toc: [],               // { label, page }
    };
}

function contentWidth(ctx) {
    return ctx.pageWidth - ctx.margin * 2;
}

function newPage(ctx) {
    ctx.doc.addPage();
    return ctx.margin + HEADER_H + 14;
}

function ensureSpace(ctx, y, needed) {
    if (y + needed > ctx.pageHeight - ctx.margin - 18) return newPage(ctx);
    return y;
}

/* ---------------- primitives ---------------- */

function sectionHeading(ctx, num, text, y, accent) {
    y = ensureSpace(ctx, y, 34);
    const { doc, margin, pageWidth } = ctx;
    doc.setFillColor(...accent);
    doc.rect(margin, y - 10, 3.5, 13, "F");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.setFont(undefined, "bold");
    doc.text(`${num}  ${text}`, margin + 10, y);
    doc.setFont(undefined, "normal");
    y += 7;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    return y + 16;
}

function paragraph(ctx, text, y, opts = {}) {
    if (!text) return y;
    const { doc, margin } = ctx;
    const { fontSize = 8.5, color = GREY } = opts;
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentWidth(ctx));
    y = ensureSpace(ctx, y, lines.length * 11 + 4);
    doc.text(lines, margin, y);
    return y + lines.length * 11 + 10;
}

function emptyNote(ctx, text, y) {
    y = ensureSpace(ctx, y, 24);
    const { doc, margin } = ctx;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, y - 9, contentWidth(ctx), 20, 2, 2, "F");
    doc.setFontSize(8.5);
    doc.setTextColor(...FAINT);
    doc.text(text, margin + 8, y + 3.5);
    return y + 24;
}

/* KPI cards laid out in a 2-column grid */
function kpiGrid(ctx, items, y, accent) {
    const list = (items || []).filter((i) => i && i.value != null);
    if (!list.length) return y;
    const { doc, margin } = ctx;
    const cols = 2;
    const gap = 10;
    const cardW = (contentWidth(ctx) - gap * (cols - 1)) / cols;
    const cardH = 34;

    for (let i = 0; i < list.length; i += cols) {
        y = ensureSpace(ctx, y, cardH + 8);
        for (let c = 0; c < cols; c++) {
            const item = list[i + c];
            if (!item) continue;
            const x = margin + c * (cardW + gap);
            doc.setFillColor(250, 250, 252);
            doc.setDrawColor(...LINE);
            doc.setLineWidth(0.5);
            doc.roundedRect(x, y, cardW, cardH, 3, 3, "FD");
            doc.setFillColor(...accent);
            doc.rect(x, y, 2.5, cardH, "F");
            doc.setFontSize(6.8);
            doc.setTextColor(...GREY);
            doc.text(String(item.label).toUpperCase(), x + 9, y + 11);
            doc.setFontSize(11);
            doc.setFont(undefined, "bold");
            doc.setTextColor(...(item.tone === "danger" ? DANGER : item.tone === "ok" ? OK : INK));
            doc.text(String(item.value), x + 9, y + 25);
            doc.setFont(undefined, "normal");
        }
        y += cardH + 8;
    }
    return y + 6;
}

/* zebra table with numeric right-alignment */
function dataTable(ctx, head, body, y, accent, opts = {}) {
    if (!body?.length) return emptyNote(ctx, "No data for this period.", y);
    const { doc, margin } = ctx;
    const { numericCols = [], maxRows = 25, firstColWide = true } = opts;
    const rows = body.slice(0, maxRows);
    const columnStyles = {};
    numericCols.forEach((i) => (columnStyles[i] = { halign: "right" }));
    if (firstColWide) columnStyles[0] = { ...(columnStyles[0] || {}), cellWidth: "auto" };

    doc.autoTable({
        startY: y,
        head: [head],
        body: rows,
        theme: "plain",
        styles: {
            fontSize: 7.8,
            cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
            overflow: "linebreak",
            textColor: INK,
            lineColor: LINE,
        },
        headStyles: {
            fillColor: [248, 249, 251],
            textColor: GREY,
            fontSize: 7,
            fontStyle: "bold",
            lineWidth: { bottom: 0.8 },
            lineColor: accent,
        },
        alternateRowStyles: { fillColor: [250, 250, 252] },
        columnStyles,
        margin: { left: margin, right: margin, top: ctx.margin + HEADER_H + 10 },
        tableWidth: contentWidth(ctx),
        didParseCell: (d) => {
            if (d.section === "head") d.cell.styles.halign = numericCols.includes(d.column.index) ? "right" : "left";
        },
    });
    let endY = doc.lastAutoTable.finalY;
    if (body.length > maxRows) {
        endY += 12;
        doc.setFontSize(7.2);
        doc.setTextColor(...FAINT);
        doc.text(`… ${body.length - maxRows} more rows omitted`, margin, endY);
        endY += 4;
    }
    return endY + 16;
}

/* bar chart with gridlines, ticks and average line */
function drawBarChart(ctx, series, y, accent, title, fmt) {
    if (!series?.length) return y;
    const { doc, margin } = ctx;
    const chartH = 70;
    const axisPad = 46;
    y = ensureSpace(ctx, y, chartH + 44);

    const values = series.map((d) => d.value || 0);
    const maxVal = Math.max(...values, 1);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const chartW = contentWidth(ctx) - axisPad;
    const x0 = margin + axisPad;

    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.setFont(undefined, "bold");
    doc.text(title, margin, y);
    doc.setFont(undefined, "normal");
    y += 10;
    const top = y;

    // gridlines + y ticks (0, 50%, 100%)
    doc.setFontSize(6.3);
    doc.setTextColor(...FAINT);
    [0, 0.5, 1].forEach((t) => {
        const gy = top + chartH - t * chartH;
        doc.setDrawColor(...(t === 0 ? LINE : [238, 240, 244]));
        doc.setLineWidth(0.4);
        doc.line(x0, gy, x0 + chartW, gy);
        doc.text(fmt ? fmt(maxVal * t) : String(Math.round(maxVal * t)), x0 - 5, gy + 2, { align: "right" });
    });

    // average dashed line
    if (avg > 0) {
        const ay = top + chartH - (avg / maxVal) * chartH;
        doc.setDrawColor(...GREY);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(x0, ay, x0 + chartW, ay);
        doc.setLineDashPattern([], 0);
        doc.text(`avg ${fmt ? fmt(avg) : Math.round(avg)}`, x0 + chartW, ay - 3, { align: "right" });
    }

    // bars
    const step = chartW / series.length;
    const barW = Math.max(1.5, Math.min(9, step - 1.5));
    for (let i = 0; i < series.length; i++) {
        const h = (values[i] / maxVal) * chartH;
        const x = x0 + i * step + (step - barW) / 2;
        const isLast = i === series.length - 1;
        doc.setFillColor(...(isLast ? DANGER : accent));
        doc.rect(x, top + chartH - h, barW, Math.max(h, 0.5), "F");
    }

    // x labels
    doc.setFontSize(6.3);
    doc.setTextColor(...FAINT);
    const first = series[0]?.date, mid = series[Math.floor(series.length / 2)]?.date, last = series[series.length - 1]?.date;
    if (first) doc.text(String(first), x0, top + chartH + 10);
    if (mid && series.length > 4) doc.text(String(mid), x0 + chartW / 2, top + chartH + 10, { align: "center" });
    if (last) doc.text(String(last), x0 + chartW, top + chartH + 10, { align: "right" });

    return top + chartH + 26;
}

function anomalyCallout(ctx, data, y, fmt) {
    if (!data.anomaly?.is_anomaly) return y;
    const { doc, margin } = ctx;
    const text = data.anomaly_explanation ||
        `Today's spend of ${fmt(data.today)} is ${pctStr(data.anomaly.pct_vs_baseline)} vs the trailing baseline of ${fmt(data.anomaly.baseline_mean)}/day (z-score ${data.anomaly.z_score}).`;
    const driverText = data.anomaly_drivers?.length
        ? "Primary drivers: " + data.anomaly_drivers
            .map((d) => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${pctStr(d.pct_vs_baseline)} vs avg)`)
            .join("; ") + "."
        : null;

    const w = contentWidth(ctx);
    const bodyLines = doc.splitTextToSize(text, w - 20);
    const driverLines = driverText ? doc.splitTextToSize(driverText, w - 20) : [];
    const boxH = 26 + bodyLines.length * 10 + (driverLines.length ? driverLines.length * 9 + 8 : 0);
    y = ensureSpace(ctx, y, boxH + 10);
    const top = y - 6;

    doc.setFillColor(...DANGER_BG);
    doc.setDrawColor(...DANGER);
    doc.setLineWidth(0.6);
    doc.roundedRect(margin, top, w, boxH, 3, 3, "FD");
    doc.setFillColor(...DANGER);
    doc.rect(margin, top, 3, boxH, "F");

    doc.setFontSize(9);
    doc.setTextColor(...DANGER);
    doc.setFont(undefined, "bold");
    doc.text("ACTIVE ANOMALY", margin + 12, top + 13);
    doc.setFont(undefined, "normal");

    doc.setFontSize(8.3);
    doc.setTextColor(...INK);
    doc.text(bodyLines, margin + 12, top + 25);
    if (driverLines.length) {
        doc.setFontSize(7.6);
        doc.setTextColor(...GREY);
        doc.text(driverLines, margin + 12, top + 25 + bodyLines.length * 10 + 4);
    }
    return top + boxH + 16;
}

/* ---------------- provider sections ---------------- */

function buildAwsSection(ctx, data, extras, y, accent, fmt) {
    let n = 0;
    y = anomalyCallout(ctx, data, y, fmt);

    y = sectionHeading(ctx, `1.${++n}`, "Key Metrics", y, accent);
    y = kpiGrid(ctx, [
        { label: "Today", value: fmt(data.today) },
        { label: "Yesterday", value: fmt(data.yesterday) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: pctStr(data.vs_last_month_pct), tone: (data.vs_last_month_pct ?? 0) > 0 ? "danger" : "ok" },
        { label: "Forecast month-end", value: data.forecast_month_end?.note ? "N/A" : fmt(data.forecast_month_end?.amount) },
        { label: "Avg / day (period)", value: fmt(data.avg_per_day_30d) },
    ], y, accent);
    y = paragraph(ctx, `As of ${data.as_of_date || "—"}`, y, { fontSize: 7.5, color: FAINT });

    y = sectionHeading(ctx, `1.${++n}`, "Daily Spend Trend", y, accent);
    y = drawBarChart(ctx, data.daily_series, y, accent, "Last 30 days · latest day in red", fmt);

    y = sectionHeading(ctx, `1.${++n}`, "Cost Breakdown (MTD)", y, accent);
    y = dataTable(ctx, ["Service", "% of MTD"],
        (data.services || []).slice(0, 10).map((s) => [s.name, `${s.pct}%`]),
        y, accent, { numericCols: [1] });
    if (data.usage_types?.length) {
        y = dataTable(ctx, ["Usage Type", "% of MTD"],
            data.usage_types.slice(0, 10).map((u) => [u.name, `${u.pct}%`]),
            y, accent, { numericCols: [1] });
    }
    if (data.linked_accounts?.length > 1) {
        y = dataTable(ctx, ["Linked Account", "% of MTD"],
            data.linked_accounts.slice(0, 10).map((a) => [a.name, `${a.pct}%`]),
            y, accent, { numericCols: [1] });
    }

    const sp = data.commitment_utilization?.savings_plans;
    const ri = data.commitment_utilization?.reservations;
    y = sectionHeading(ctx, `1.${++n}`, "Commitment Utilization", y, accent);
    if (!sp && !ri) {
        y = emptyNote(ctx, "No Savings Plans or Reserved Instances active — account is fully pay-as-you-go.", y);
    } else {
        y = kpiGrid(ctx, [
            { label: "Savings Plans utilization", value: sp ? `${sp.utilization_pct}%` : "None active" },
            { label: "SP net savings", value: sp ? fmt(sp.net_savings) : "—" },
            { label: "RI utilization", value: ri ? `${ri.utilization_pct}%` : "None active" },
            { label: "Unused reserved hours", value: ri ? String(ri.unused_hours) : "—" },
        ], y, accent);
    }
    const notes = [...(data.commitment_utilization?.notes || []), data.forecast_month_end?.note || null].filter(Boolean);
    if (notes.length) y = paragraph(ctx, notes.join(" · "), y, { fontSize: 7.5, color: FAINT });

    const instances = extras?.instances;
    if (instances?.instances?.length) {
        y = sectionHeading(ctx, `1.${++n}`, `EC2 Inventory (${instances.running_count ?? 0} running · ${instances.stopped_count ?? 0} stopped · ${instances.scanned_regions?.length || 0} regions)`, y, accent);
        y = dataTable(ctx, ["Instance", "Type", "State", "Uptime", "Avg CPU 24h"],
            instances.instances.map((i) => [
                i.name, i.type, i.state,
                i.uptime_hours != null ? `${(i.uptime_hours / 24).toFixed(1)}d` : "—",
                i.avg_cpu_pct_24h != null ? `${i.avg_cpu_pct_24h}%` : "—",
            ]), y, accent, { numericCols: [3, 4] });
        const idle = instances.instances.filter((i) => i.state === "running" && i.avg_cpu_pct_24h != null && i.avg_cpu_pct_24h < 3 && (i.uptime_hours ?? 0) > 168);
        if (idle.length) {
            y = paragraph(ctx, `Possible idle: ${idle.map((i) => `${i.name} (${i.avg_cpu_pct_24h}% CPU, ${(i.uptime_hours / 24).toFixed(0)}d up)`).join("; ")} — review for stop/downsize.`, y, { fontSize: 7.8, color: DANGER });
        }
    }

    const usage = extras?.usageBreakdown;
    if (usage?.services?.length) {
        y = sectionHeading(ctx, `1.${++n}`, `Services In Use (${usage.active_service_count ?? usage.services.length} active, period total)`, y, accent);
        y = dataTable(ctx, ["Service", "% share", "Total cost"],
            usage.services.filter((s) => (s.total_cost ?? 0) > 0).map((s) => [s.service, `${s.pct}%`, fmt(s.total_cost)]),
            y, accent, { numericCols: [1, 2] });
    }
    if (usage?.regions?.length) {
        y = sectionHeading(ctx, `1.${++n}`, "Spend by Region", y, accent);
        y = dataTable(ctx, ["Region", "% share", "Cost"],
            usage.regions.filter((r) => (r.cost ?? 0) > 0).map((r) => [r.region, `${r.pct}%`, fmt(r.cost)]),
            y, accent, { numericCols: [1, 2] });
    }
    return y;
}

function buildRunPodSection(ctx, data, y, accent, fmt) {
    let n = 0;
    y = anomalyCallout(ctx, data, y, fmt);
    const periodTotal = (data.daily_series || []).reduce((s, d) => s + (d.value || 0), 0);

    y = sectionHeading(ctx, `2.${++n}`, "Key Metrics", y, accent);
    y = kpiGrid(ctx, [
        { label: "Today", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: pctStr(data.vs_last_month_pct), tone: (data.vs_last_month_pct ?? 0) > 0 ? "danger" : "ok" },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Period total", value: fmt(periodTotal) },
        { label: "Active pods", value: String(data.active_pods_count ?? "—") },
        { label: "GPU hours today", value: `${data.gpu_hours_today ?? 0}h` },
        { label: "Spot / Secure cost/hr", value: `${fmt(data.spot_cost_per_hr)} / ${fmt(data.secure_cost_per_hr)}` },
    ], y, accent);
    y = paragraph(ctx, `As of ${data.as_of || "—"}. RunPod bills per-second while pods run; an empty window means no active pods, not a billing delay.`, y, { fontSize: 7.5, color: FAINT });

    y = sectionHeading(ctx, `2.${++n}`, "GPU Spend Trend", y, accent);
    y = drawBarChart(ctx, data.daily_series, y, accent, "Last 30 days · latest day in red", fmt);

    if (data.pods?.length) {
        y = sectionHeading(ctx, `2.${++n}`, "Active Pods", y, accent);
        y = dataTable(ctx, ["Pod", "Type", "GPU", "Cost/hr", "Est. cost"],
            data.pods.map((p) => [p.name, p.interruptible ? "Spot" : "Secure", p.gpu || "—", fmt(p.adjusted_cost_per_hr ?? p.cost_per_hr), fmt(p.estimated_cost)]),
            y, accent, { numericCols: [3, 4] });
    }

    y = sectionHeading(ctx, `2.${++n}`, "Cost Breakdown", y, accent);
    y = dataTable(ctx, ["GPU Type (pod spend)", "Amount", "% share"],
        (data.gpu_breakdown || []).map((g) => [g.name, fmt(g.amount), `${g.pct ?? "—"}%`]),
        y, accent, { numericCols: [1, 2] });
    if (data.endpoint_breakdown?.length) {
        const epTotal = data.endpoint_breakdown.reduce((s, e) => s + (e.amount || 0), 0);
        y = dataTable(ctx, ["Serverless Endpoint", "Amount", "% share"],
            data.endpoint_breakdown.map((e) => [e.name, fmt(e.amount), epTotal ? `${((e.amount / epTotal) * 100).toFixed(1)}%` : "—"]),
            y, accent, { numericCols: [1, 2] });
    }

    if (data.possible_idle_pods?.length) {
        y = sectionHeading(ctx, `2.${++n}`, "Waste & Inefficiency", y, accent);
        y = dataTable(ctx, ["Pod", "GPU", "Days running", "Cost/hr"],
            data.possible_idle_pods.map((p) => [p.name, p.gpu, String(Math.round(p.uptime_seconds / 86400)), fmt(p.cost_per_hr)]),
            y, accent, { numericCols: [2, 3] });
    }
    return y;
}

function buildGoogleAdsSection(ctx, data, y, accent, fmt) {
    let n = 0;
    y = anomalyCallout(ctx, data, y, fmt);

    y = sectionHeading(ctx, `3.${++n}`, "Key Metrics", y, accent);
    y = kpiGrid(ctx, [
        { label: "Today spend", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "vs last month", value: pctStr(data.vs_last_month_pct), tone: (data.vs_last_month_pct ?? 0) > 0 ? "danger" : "ok" },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Conversions (period)", value: String(data.total_conversions_period ?? 0) },
        { label: "ROAS", value: data.roas != null ? `${data.roas}x` : "—", tone: (data.roas ?? 0) < 1 ? "danger" : "ok" },
        { label: "Avg CPC", value: fmt(data.avg_cpc) },
        { label: "Avg CPM", value: fmt(data.avg_cpm) },
    ], y, accent);

    y = sectionHeading(ctx, `3.${++n}`, "Trends", y, accent);
    y = drawBarChart(ctx, data.daily_series, y, accent, "Daily ad spend", fmt);
    y = drawBarChart(ctx, data.cpc_trend, y, accent, "CPC", fmt);
    y = drawBarChart(ctx, data.cpm_trend, y, accent, "CPM", fmt);

    if (data.campaigns?.length) {
        y = sectionHeading(ctx, `3.${++n}`, "Campaigns (today)", y, accent);
        y = dataTable(ctx, ["Campaign", "Amount", "% share", "ROAS"],
            data.campaigns.filter((c) => (c.amount ?? 0) > 0).map((c) => [c.name, fmt(c.amount), `${c.pct}%`, c.roas != null ? `${c.roas}x` : "—"]),
            y, accent, { numericCols: [1, 2, 3] });
        const inactive = data.campaigns.filter((c) => !((c.amount ?? 0) > 0)).length;
        if (inactive) y = paragraph(ctx, `${inactive} campaigns with zero spend today omitted.`, y, { fontSize: 7.3, color: FAINT });
    }

    if (data.network_breakdown?.length) {
        y = sectionHeading(ctx, `3.${++n}`, "Cost by Network (period)", y, accent);
        y = dataTable(ctx, ["Network", "Amount", "% share"],
            data.network_breakdown.map((k) => [k.name, fmt(k.amount), `${k.pct}%`]),
            y, accent, { numericCols: [1, 2] });
    }

    if (data.wasted_spend?.length || data.rank_loss?.length) {
        y = sectionHeading(ctx, `3.${++n}`, "Waste & Lost Opportunity", y, accent);
        if (data.wasted_spend?.length) {
            const totalWaste = data.wasted_spend.reduce((s, c) => s + (c.amount || 0), 0);
            y = paragraph(ctx, `Zero-conversion campaigns burned ${fmt(totalWaste)} this period:`, y, { fontSize: 8, color: DANGER });
            y = dataTable(ctx, ["Campaign (0 conversions)", "Clicks", "Amount"],
                data.wasted_spend.map((c) => [c.name, String(c.clicks), fmt(c.amount)]),
                y, accent, { numericCols: [1, 2] });
        }
        if (data.rank_loss?.length) {
            y = dataTable(ctx, ["Campaign", "Rank lost %", "Spend"],
                data.rank_loss.map((c) => [c.name, `${c.rank_lost_pct}%`, fmt(c.amount)]),
                y, accent, { numericCols: [1, 2] });
        }
    }
    return y;
}

function buildMs365Section(ctx, data, y, accent) {
    const fmt = fmtINR;
    let n = 0;

    y = sectionHeading(ctx, `4.${++n}`, "Key Metrics", y, accent);
    y = kpiGrid(ctx, [
        { label: "Total licences", value: String(data.total_licenses ?? "—") },
        { label: "Monthly bill", value: fmt(data.monthly_bill) },
        { label: "Bill change vs last week", value: data.bill_change_vs_last_week != null ? fmt(data.bill_change_vs_last_week) : "—", tone: (data.bill_change_vs_last_week ?? 0) > 0 ? "danger" : "ok" },
        { label: "Cost per user", value: fmt(data.cost_per_user) },
        { label: "Standard / Basic", value: `${data.standard_count ?? 0} / ${data.basic_count ?? 0}` },
        { label: "Free / trial seats", value: String(data.free_count ?? 0) },
        { label: "MFA pending", value: String(data.mfa_pending ?? 0), tone: (data.mfa_pending ?? 0) > 0 ? "danger" : "ok" },
        { label: "New IDs (7d)", value: `${(data.new_ids_7d ?? 0) > 0 ? "+" : ""}${data.new_ids_7d ?? 0}` },
    ], y, accent);
    y = paragraph(ctx, "All Microsoft 365 figures are true Indian list pricing in INR — the report currency toggle does not apply to this section.", y, { fontSize: 7.5, color: FAINT });

    if (data.license_trend?.length) {
        y = sectionHeading(ctx, `4.${++n}`, "Monthly Bill Trend", y, accent);
        y = drawBarChart(ctx, data.license_trend.map((r) => ({ date: r.date, value: r.monthly_bill })), y, accent, "Licence bill snapshots", fmt);
    }

    if (data.recent_users?.length) {
        y = sectionHeading(ctx, `4.${++n}`, `Licensed Seats (${data.recent_users.length})`, y, accent);
        y = dataTable(ctx, ["Name", "Email", "Licence", "Cost/mo"],
            data.recent_users.slice(0, 40).map((u) => [u.name, u.email, u.license, fmt(u.cost)]),
            y, accent, { numericCols: [3] });
    }

    y = sectionHeading(ctx, `4.${++n}`, "Inactive Seats", y, accent);
    if (data.sign_in_activity_available && data.inactive_licensed_users?.length) {
        y = dataTable(ctx, ["Name", "Email", "Licence", "Last sign-in", "Cost/mo"],
            data.inactive_licensed_users.slice(0, 40).map((u) => [u.name, u.email, u.license, u.last_sign_in || "never", fmt(u.cost)]),
            y, accent, { numericCols: [4] });
    } else if (data.sign_in_activity_available) {
        y = emptyNote(ctx, "No inactive licensed seats detected.", y);
    } else {
        y = emptyNote(ctx, "Unavailable — grant AuditLog.Read.All on the Azure AD app registration to enable sign-in-based detection.", y);
    }

    if (data.license_trend?.length) {
        y = sectionHeading(ctx, `4.${++n}`, "Licence Snapshots", y, accent);
        y = dataTable(ctx, ["Date", "Total", "Standard", "Basic", "Monthly bill"],
            data.license_trend.slice(-14).map((r) => [r.date, String(r.total_licenses), String(r.standard_count), String(r.basic_count), fmt(r.monthly_bill)]),
            y, accent, { numericCols: [1, 2, 3, 4] });
    }
    return y;
}

function buildE2eSection(ctx, data, y, accent) {
    const fmt = fmtINR;
    let n = 0;
    y = anomalyCallout(ctx, data, y, fmt);
    const periodTotal = (data.daily_series || []).reduce((s, d) => s + (d.value || 0), 0);
    const hasActivity = periodTotal > 0 || (data.active_nodes_count ?? 0) > 0;

    y = sectionHeading(ctx, `5.${++n}`, "Key Metrics", y, accent);
    if (!hasActivity) {
        y = kpiGrid(ctx, [
            { label: "Period total", value: fmt(0) },
            { label: "Active nodes", value: "0" },
            { label: "Free tier hrs remaining", value: `${(data.free_tier_hours_remaining || 0).toFixed(1)}h` },
            { label: "Status", value: "No activity this period", tone: "ok" },
        ], y, accent);
        return y;
    }
    y = kpiGrid(ctx, [
        { label: "Today", value: fmt(data.today) },
        { label: "Month to date", value: fmt(data.month_to_date) },
        { label: "Projected month-end", value: fmt(data.projected_month_end) },
        { label: "Period total", value: fmt(periodTotal) },
        { label: "Active nodes", value: String(data.active_nodes_count ?? "—") },
        { label: "GPU / CPU hrs today", value: `${(data.gpu_hours_today || 0).toFixed(1)}h / ${(data.cpu_hours_today || 0).toFixed(1)}h` },
        { label: "Free tier hrs remaining", value: `${(data.free_tier_hours_remaining || 0).toFixed(1)}h` },
    ], y, accent);

    y = sectionHeading(ctx, `5.${++n}`, "Node Spend Trend", y, accent);
    y = drawBarChart(ctx, data.daily_series, y, accent, "Node spend", fmt);

    if (data.nodes?.length) {
        y = sectionHeading(ctx, `5.${++n}`, "Active Nodes", y, accent);
        y = dataTable(ctx, ["Node", "Plan", "GPU", "Status", "Cost/hr"],
            data.nodes.map((k) => [k.name, k.plan || "—", k.gpu || "—", k.status, fmt(k.cost_per_hr)]),
            y, accent, { numericCols: [4] });
    }
    if (data.node_breakdown?.length) {
        y = sectionHeading(ctx, `5.${++n}`, "SKU / Node Type Breakdown", y, accent);
        y = dataTable(ctx, ["Node Type", "Amount", "% share"],
            data.node_breakdown.map((k) => [k.name, fmt(k.amount), `${k.pct ?? "—"}%`]),
            y, accent, { numericCols: [1, 2] });
    }
    if (data.historical_spikes?.length) {
        y = sectionHeading(ctx, `5.${++n}`, "Spend Spikes", y, accent);
        y = dataTable(ctx, ["Date", "Spike %", "Top Driver", "Value", "Baseline"],
            data.historical_spikes.map((s) => [s.date, `+${s.pct_increase}%`, s.top_driver, fmt(s.value), fmt(s.baseline_mean)]),
            y, accent, { numericCols: [1, 3, 4] });
    }
    if (data.possible_idle_nodes?.length) {
        y = sectionHeading(ctx, `5.${++n}`, "Waste & Inefficiency", y, accent);
        y = dataTable(ctx, ["Node", "GPU", "Days running", "Cost/hr"],
            data.possible_idle_nodes.map((k) => [k.name, k.gpu, String(Math.round(k.uptime_seconds / 86400)), fmt(k.cost_per_hr)]),
            y, accent, { numericCols: [2, 3] });
    }
    return y;
}

/* ---------------- cover, TOC, chrome ---------------- */

function coverPage(ctx, overview, fmt) {
    const { doc, margin, pageWidth, pageHeight } = ctx;

    // full dark cover
    doc.setFillColor(...DARK);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    // accent strip of provider colors
    const stripW = pageWidth / 5;
    Object.values(ACCENT_RGB).forEach((rgb, i) => {
        doc.setFillColor(...rgb);
        doc.rect(i * stripW, 0, stripW, 5, "F");
    });

    let y = 150;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(30);
    doc.setFont(undefined, "bold");
    doc.text("SpendWatch", margin, y);
    doc.setFont(undefined, "normal");
    y += 22;
    doc.setFontSize(13);
    doc.setTextColor(180, 186, 198);
    doc.text("Full Cloud Spend Report", margin, y);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(140, 146, 160);
    doc.text(`Generated ${new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}  ·  Xarka internal`, margin, y);

    // hero KPI cards
    y += 44;
    const { today_total, month_to_date_total, projected_month_end, active_anomalies } = overview || {};
    const heroes = [
        ["TODAY (ALL PROVIDERS)", fmt(today_total), [255, 255, 255]],
        ["MONTH TO DATE", fmt(month_to_date_total), [255, 255, 255]],
        ["PROJECTED MONTH-END", fmt(projected_month_end), [255, 255, 255]],
        ["ACTIVE ANOMALIES", String(active_anomalies?.length ?? 0), (active_anomalies?.length ?? 0) > 0 ? [252, 165, 165] : [134, 239, 172]],
    ];
    const cardW = (pageWidth - margin * 2 - 30) / 2;
    const cardH = 58;
    heroes.forEach((h, i) => {
        const x = margin + (i % 2) * (cardW + 30);
        const cy = y + Math.floor(i / 2) * (cardH + 16);
        doc.setFillColor(28, 33, 45);
        doc.roundedRect(x, cy, cardW, cardH, 4, 4, "F");
        doc.setFontSize(7);
        doc.setTextColor(140, 146, 160);
        doc.text(h[0], x + 14, cy + 18);
        doc.setFontSize(17);
        doc.setFont(undefined, "bold");
        doc.setTextColor(...h[2]);
        doc.text(h[1], x + 14, cy + 42);
        doc.setFont(undefined, "normal");
    });
    y += 2 * (cardH + 16) + 30;

    // anomaly summary lines on cover
    if (active_anomalies?.length) {
        doc.setFontSize(8.5);
        doc.setTextColor(252, 165, 165);
        active_anomalies.slice(0, 4).forEach((a) => {
            const label = PROVIDER_LABEL[a.provider] || a.provider || "";
            const line = typeof a === "string" ? a : `${label}${a.pct_vs_baseline != null ? ` — ${pctStr(a.pct_vs_baseline)} vs baseline` : ""}`;
            doc.text(`•  ${line}`, margin, y);
            y += 13;
        });
    }

    doc.setFontSize(7.5);
    doc.setTextColor(110, 116, 130);
    doc.text("Confidential — internal use only", margin, pageHeight - 30);
}

function tocPage(ctx) {
    const { doc, margin, pageWidth } = ctx;
    doc.addPage();
    ctx.tocPageNo = doc.internal.getNumberOfPages();
    let y = margin + 30;
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.setFont(undefined, "bold");
    doc.text("Contents", margin, y);
    doc.setFont(undefined, "normal");
    y += 8;
    doc.setDrawColor(...LINE);
    doc.line(margin, y, pageWidth - margin, y);
    ctx.tocStartY = y + 20;
}

function fillToc(ctx) {
    const { doc, margin, pageWidth } = ctx;
    doc.setPage(ctx.tocPageNo);
    let y = ctx.tocStartY;
    ctx.toc.forEach((entry, i) => {
        const accent = ACCENT_RGB[entry.key];
        doc.setFillColor(...accent);
        doc.circle(margin + 4, y - 3, 3, "F");
        doc.setFontSize(10.5);
        doc.setTextColor(...INK);
        doc.text(`${i + 1}.  ${entry.label}`, margin + 14, y);
        // dotted leader
        doc.setFontSize(9);
        doc.setTextColor(...FAINT);
        const labelW = doc.getTextWidth(`${i + 1}.  ${entry.label}`) + 20;
        let dots = "";
        const dotW = doc.getTextWidth(". ");
        const avail = pageWidth - margin * 2 - labelW - 24;
        for (let w = 0; w < avail; w += dotW) dots += ". ";
        doc.text(dots, margin + labelW, y);
        doc.setFontSize(10.5);
        doc.setTextColor(...GREY);
        doc.text(String(entry.page), pageWidth - margin, y, { align: "right" });
        doc.link(margin, y - 9, pageWidth - margin * 2, 12, { pageNumber: entry.page });
        y += 22;
    });
}

function chrome(ctx) {
    const { doc, pageWidth, pageHeight, margin } = ctx;
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 2; i <= pageCount; i++) { // skip cover
        doc.setPage(i);
        const provider = ctx.pageProvider?.[i];
        // header
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.5);
        doc.line(margin, margin + HEADER_H - 8, pageWidth - margin, margin + HEADER_H - 8);
        doc.setFontSize(7.5);
        doc.setTextColor(...FAINT);
        doc.text("SPENDWATCH · FULL SPEND REPORT", margin, margin + HEADER_H - 14);
        if (provider) {
            doc.setTextColor(...(ACCENT_RGB[provider] || GREY));
            doc.setFont(undefined, "bold");
            doc.text(PROVIDER_LABEL[provider].toUpperCase(), pageWidth - margin, margin + HEADER_H - 14, { align: "right" });
            doc.setFont(undefined, "normal");
        }
        // footer
        doc.setFontSize(7.5);
        doc.setTextColor(...FAINT);
        doc.text(new Date().toLocaleDateString("en-IN"), margin, pageHeight - 16);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 16, { align: "right" });
    }
}

function providerBanner(ctx, key, num) {
    const { doc, margin, pageWidth } = ctx;
    const accent = ACCENT_RGB[key];
    let y = margin + HEADER_H + 10;
    doc.setFillColor(...accent);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 40, 4, 4, "F");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, "bold");
    doc.text(`${num}.  ${PROVIDER_LABEL[key]}`, margin + 16, y + 26);
    doc.setFont(undefined, "normal");
    return y + 58;
}

const SECTION_BUILDERS = {
    aws: (ctx, data, y, accent, fmt, extras) => buildAwsSection(ctx, data, extras, y, accent, fmt),
    runpod: (ctx, data, y, accent, fmt) => buildRunPodSection(ctx, data, y, accent, fmt),
    google_ads: (ctx, data, y, accent, fmt) => buildGoogleAdsSection(ctx, data, y, accent, fmt),
    ms365: (ctx, data, y, accent) => buildMs365Section(ctx, data, y, accent),
    e2e: (ctx, data, y, accent) => buildE2eSection(ctx, data, y, accent),
};

/* ---------------- component ---------------- */

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

            const { default: jsPDF } = await import("jspdf");
            await import("jspdf-autotable");
            const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
            const ctx = makeCtx(doc);
            ctx.pageProvider = {};

            coverPage(ctx, overview, fmt);
            tocPage(ctx);

            const order = ["aws", "runpod", "google_ads", "ms365", "e2e"];
            let num = 0;
            for (const key of order) {
                const data = overview.providers?.[key];
                if (!data) continue;
                num += 1;
                const accent = ACCENT_RGB[key];

                doc.addPage();
                const startPage = doc.internal.getNumberOfPages();
                ctx.toc.push({ key, label: PROVIDER_LABEL[key], page: startPage });
                ctx.currentProvider = key;

                let y = providerBanner(ctx, key, num);
                const providerFmt = key === "ms365" || key === "e2e" ? fmtINR : fmt;
                y = SECTION_BUILDERS[key](ctx, data, y, accent, providerFmt, awsExtras);

                // tag every page of this provider for the running header
                for (let p = startPage; p <= doc.internal.getNumberOfPages(); p++) {
                    ctx.pageProvider[p] = key;
                }
            }

            fillToc(ctx);
            chrome(ctx);
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