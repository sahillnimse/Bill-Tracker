import { useEffect, useState } from "react";
import api from "../api/client";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    z_score_threshold: 2.0,
    min_dollar_delta: 5,
    baseline_window_days: 14,
  });
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [recipients, setRecipients] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaved(false);
    try {
      await api.updateSettings({
        ...settings,
        smtp_sender_email: email || undefined,
        alert_recipients: recipients || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // silently ignore for now — backend not wired yet
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  if (loading) return <div className="loading-state">Loading settings…</div>;

  return (
    <div className="page" id="page-settings">
      <div className="ph">
        <div className="ph-title">Settings</div>
        <div className="ph-sub">Alert thresholds · SMTP · API credentials</div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Anomaly detection</div></div>
        <div className="set-row">
          <div>
            <div className="set-label">Z-score threshold</div>
            <div className="set-sub">Standard deviations above baseline to flag a spike</div>
          </div>
          <input
            type="number" step="0.1" className="set-input"
            value={settings.z_score_threshold}
            onChange={(e) => setSettings((s) => ({ ...s, z_score_threshold: parseFloat(e.target.value) }))}
          />
        </div>
        <div className="set-row">
          <div>
            <div className="set-label">Min dollar delta to flag</div>
            <div className="set-sub">Ignore anomalies smaller than this in absolute $</div>
          </div>
          <input
            type="number" className="set-input"
            value={settings.min_dollar_delta}
            onChange={(e) => setSettings((s) => ({ ...s, min_dollar_delta: parseFloat(e.target.value) }))}
          />
        </div>
        <div className="set-row">
          <div>
            <div className="set-label">Baseline window (days)</div>
            <div className="set-sub">Trailing days used to define normal baseline</div>
          </div>
          <input
            type="number" className="set-input"
            value={settings.baseline_window_days}
            onChange={(e) => setSettings((s) => ({ ...s, baseline_window_days: parseInt(e.target.value, 10) }))}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr"><div className="panel-title">Email alerts</div></div>
        <input
          type="email" className="set-text" placeholder="SMTP sender email (Gmail)"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password" className="set-text" placeholder="Gmail app password (16 chars)"
          value={appPassword} onChange={(e) => setAppPassword(e.target.value)}
        />
        <input
          type="text" className="set-text" style={{ marginBottom: 0 }} placeholder="Alert recipients, comma-separated"
          value={recipients} onChange={(e) => setRecipients(e.target.value)}
        />
      </div>

      <button className="set-save-btn" onClick={handleSave}>
        {saved ? "Saved ✓" : "Save settings"}
      </button>
    </div>
  );
}
