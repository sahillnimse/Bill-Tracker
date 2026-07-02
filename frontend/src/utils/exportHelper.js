// src/utils/exportHelper.js

/**
 * Triggers a download of the given data as a JSON file.
 * @param {Object} data - The data to be exported.
 * @param {string} name - Base name for the file (e.g., 'aws').
 */
export function exportJson(data, name) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const timestamp = now.toISOString().split(".")[0].replace(/[:T]/g, "-");
  const filename = `${name}_export_${timestamp}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
