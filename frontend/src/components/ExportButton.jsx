import React from 'react';

/**
 * Converts a flat object to CSV rows.
 */
function objectToRows(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && !Array.isArray(v) && typeof v !== 'object')
    .map(([k, v]) => `${k},${String(v).replace(/,/g, ';')}`);
}

/**
 * Converts an array of objects to a CSV table (header + rows).
 */
function arrayToTable(arr, sectionLabel) {
  if (!arr || arr.length === 0) return [];
  const keys = Object.keys(arr[0]);
  const header = keys.join(',');
  const rows = arr.map(row =>
    keys.map(k => {
      const val = row[k] ?? '';
      const str = String(val).replace(/,/g, ';').replace(/\n/g, ' ');
      return str.includes(' ') ? `"${str}"` : str;
    }).join(',')
  );
  return [`\n${sectionLabel}`, header, ...rows];
}

/**
 * Builds a full CSV string from the provider data object.
 * Scalar fields → Summary section
 * Array fields  → individual labeled tables
 */
function buildCsv(data) {
  const lines = [];

  // ── Summary section (scalar / primitive fields) ──
  lines.push('=== SUMMARY ===');
  lines.push('Field,Value');
  lines.push(...objectToRows(data));

  // ── Nested object fields (e.g. anomaly) ──
  Object.entries(data).forEach(([key, val]) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(`\n=== ${key.toUpperCase()} ===`);
      lines.push('Field,Value');
      lines.push(...objectToRows(val));
    }
  });

  // ── Array fields (daily_series, services, campaigns, pods, etc.) ──
  Object.entries(data).forEach(([key, val]) => {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      lines.push(...arrayToTable(val, `=== ${key.toUpperCase()} ===`));
    }
  });

  return lines.join('\n');
}

/**
 * ExportButton – downloads provider data as a CSV file.
 * Props:
 *   data: object     – the data to export
 *   filename: string – base name, e.g. 'aws_data' (extension replaced with .csv)
 *   label: string    – button label (default: 'Export')
 */
export default function ExportButton({ data, filename, label = 'Export' }) {
  const handleExport = () => {
    try {
      const csvFilename = filename.replace(/\.[^/.]+$/, '') + '.csv';
      const csv = buildCsv(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFilename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    }
  };

  return (
    <button className="export-btn" onClick={handleExport} title="Download data as CSV (opens in Excel / Google Sheets)">
      {label}
    </button>
  );
}
