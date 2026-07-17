import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const FILENAME_LABELS = {
  aws_data: "AWS",
  runpod_data: "RunPod",
  google_ads_data: "Google Ads",
  ms365_data: "Microsoft 365",
  e2e_networks_data: "E2E Networks",
};

function providerLabel(filename) {
  const base = filename.replace(/\.[^/.]+$/, "");
  return FILENAME_LABELS[base] || base;
}

function extractKPIs(data) {
  const kpis = [];
  const scalar = ["today", "yesterday", "month_to_date", "avg_per_day", "avg_per_day_30d", "monthly_bill", "total_licenses", "basic_count", "standard_count", "free_count", "roas", "avg_cpc", "active_pods_count", "active_nodes_count", "gpu_hours_today", "cpu_hours_today", "new_ids_7d", "mfa_pending", "projected_month_end", "inactive_licensed_count", "inactive_monthly_waste", "cost_per_user"];
  for (const key of scalar) {
    if (key in data && data[key] != null) {
      kpis.push([key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), String(data[key])]);
    }
  }
  return kpis;
}

function drawBarChart(doc, series, startY, pageWidth) {
  if (!series || series.length === 0) return startY;
  const margin = 20;
  const chartLeft = margin;
  const chartWidth = pageWidth - margin * 2;
  const chartHeight = 60;
  const barWidth = Math.max(2, Math.min(8, chartWidth / series.length - 1));
  const values = series.map((d) => d.value || 0);
  const maxVal = Math.max(...values, 1);
  const chartTop = startY + 10;

  doc.setFontSize(8);
  doc.text("Daily spend (last " + series.length + " days)", margin, startY + 4);

  const barColor = doc.getRgbColor ? null : [54, 162, 235];
  const r = 54 / 255, g = 162 / 255, b = 235 / 255;
  const step = chartWidth / series.length;

  for (let i = 0; i < series.length; i++) {
    const barH = (values[i] / maxVal) * chartHeight;
    const x = chartLeft + i * step + (step - barWidth) / 2;
    const y = chartTop + chartHeight - barH;
    doc.setFillColor(r, g, b);
    doc.rect(x, y, barWidth, barH, "F");
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(chartLeft, chartTop, chartLeft, chartTop + chartHeight);
  doc.line(chartLeft, chartTop + chartHeight, chartLeft + chartWidth, chartTop + chartHeight);

  doc.setFontSize(6);
  doc.text("0", chartLeft - 2, chartTop + chartHeight + 3);
  doc.text(String(Math.round(maxVal)), chartLeft - 2, chartTop - 2);

  return chartTop + chartHeight + 15;
}

export default function ExportButton({ data, filename, label = "Export Details" }) {
  const handleExport = () => {
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let y = margin + 10;

      const pLabel = providerLabel(filename);

      doc.setFontSize(18);
      doc.text(pLabel + " — Spend Summary", margin, y);
      y += 16;

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text("Generated: " + new Date().toLocaleString(), margin, y);
      y += 20;
      doc.setTextColor(0, 0, 0);

      doc.setFontSize(12);
      doc.text("Key Metrics", margin, y);
      y += 8;

      const kpis = extractKPIs(data);
      if (kpis.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [["Metric", "Value"]],
          body: kpis,
          theme: "grid",
          headStyles: { fillColor: [30, 40, 60], fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          margin: { left: margin, right: margin },
          tableWidth: pageWidth - margin * 2,
        });
        y = doc.lastAutoTable.finalY + 15;
      }

      if (data.anomaly && data.anomaly.is_anomaly) {
        doc.setFontSize(12);
        doc.setTextColor(200, 60, 60);
        doc.text("Active Anomaly", margin, y);
        y += 14;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);

        const explanation = data.anomaly_explanation || "";
        const lines = doc.splitTextToSize(explanation || (
          "Anomaly detected: today " + (data.anomaly.today_value || 0) +
          " vs baseline " + (data.anomaly.baseline_mean || 0) +
          " (" + (data.anomaly.pct_vs_baseline || 0) + "% change, z-score " +
          (data.anomaly.z_score || 0) + ")."
        ), pageWidth - margin * 2);
        doc.text(lines, margin, y);
        y += lines.length * 12 + 10;
      }

      const series = data.daily_series || data.license_trend;
      if (series && series.length > 0) {
        if (y + 100 > doc.internal.pageSize.getHeight()) {
          doc.addPage();
          y = margin + 10;
        }
        y = drawBarChart(doc, series, y, pageWidth);
      }

      const pdfFilename = filename.replace(/\.[^/.]+$/, "") + ".pdf";
      doc.save(pdfFilename);
    } catch (e) {
      console.error("PDF export failed", e);
    }
  };

  return (
    <button className="export-btn" onClick={handleExport} title="Download summary as PDF">
      {label}
    </button>
  );
}
