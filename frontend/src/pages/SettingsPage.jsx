import { useEffect, useState } from "react";
import api from "../api/client";

function ToggleSwitch({ checked, onChange }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

function NumericRow({ label, sub, value, onChange, step = 0.1, min = 0 }) {
  return (
    <div className="set-row2">
      <div className="set-row2-info">
        <div className="set-label2">{label}</div>
        {sub && <div className="set-sub2">{sub}</div>}
      </div>
      <div className="set-stepper">
        <button className="stepper-btn" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
        <span className="stepper-val">{value}</span>
        <button className="stepper-btn" onClick={() => onChange(+(value + step).toFixed(2))}>+</button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    z_score_threshold: 2.0,
    min_dollar_delta: 5,
    baseline_window_days: 14,
  });
  const [email, setEmail]           = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [recipients, setRecipients] = useState("");
  const [saved, setSaved]           = useState(false);
  const [saveError, setSaveError]   = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaved(false);
    setSaveError(null);
    try {
      await api.updateSettings({
        ...settings,
        smtp_app_password: appPassword || undefined,
        smtp_sender_email: email || undefined,
        alert_recipients: recipients || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err?.response?.data?.detail || "Failed to save settings.");
    }
  };

  if (loading) return (
    <div className="page" id="page-settings">
      <div className="skeleton-hero" style={{ height: 64, marginBottom: 24 }} />
      <div className="skeleton-card" style={{ height: 180, marginBottom: 14 }} />
      <div className="skeleton-card" style={{ height: 180 }} />
    </div>
  );

  return (
    <div className="page" id="page-settings">
      <div className="ph2">
        <div className="ph2-icon">⚙</div>
        <div>
          <div className="ph2-title">Settings</div>
          <div className="ph2-sub">Alert thresholds · SMTP · API credentials</div>
        </div>
      </div>

      {/* ── Anomaly Detection ── */}
      <div className="settings-section">
        <div className="settings-section-hdr">
          <div className="settings-section-icon" style={{ background: "rgba(167,139,250,0.12)", color: "var(--violet)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 12H1L7 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M7 5v3M7 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="settings-section-title">Anomaly detection</div>
            <div className="settings-section-sub">Tune the sensitivity of spend spike alerts</div>
          </div>
        </div>

        <NumericRow
          label="Z-score threshold"
          sub="Standard deviations above baseline to flag a spike. Lower = more sensitive."
          value={settings.z_score_threshold}
          step={0.1}
          min={0.1}
          onChange={v => setSettings(s => ({ ...s, z_score_threshold: v }))}
        />
        <NumericRow
          label="Min dollar delta to flag"
          sub="Ignore anomalies smaller than this amount in absolute dollars."
          value={settings.min_dollar_delta}
          step={1}
          min={0}
          onChange={v => setSettings(s => ({ ...s, min_dollar_delta: v }))}
        />
        <NumericRow
          label="Baseline window (days)"
          sub="Trailing days used to define the normal spend baseline."
          value={settings.baseline_window_days}
          step={1}
          min={3}
          onChange={v => setSettings(s => ({ ...s, baseline_window_days: v }))}
        />
      </div>

      {/* ── Email Alerts ── */}
      <div className="settings-section">
        <div className="settings-section-hdr">
          <div className="settings-section-icon" style={{ background: "rgba(0,229,212,0.10)", color: "var(--cyan)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1 4l6 4.5L13 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="settings-section-title">Email alerts</div>
            <div className="settings-section-sub">Configure SMTP for anomaly notifications</div>
          </div>
        </div>

        <div className="set-row2">
          <div className="set-row2-info">
            <div className="set-label2">SMTP sender email</div>
            <div className="set-sub2">Gmail address used to send anomaly alerts</div>
          </div>
        </div>
        <input
          type="email"
          className="set-field"
          placeholder="you@gmail.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <div className="set-row2" style={{ marginTop: 12 }}>
          <div className="set-row2-info">
            <div className="set-label2">Gmail app password</div>
            <div className="set-sub2">16-character app password from Google Account → Security</div>
          </div>
        </div>
        <input
          type="password"
          className="set-field"
          placeholder="xxxx xxxx xxxx xxxx"
          value={appPassword}
          onChange={e => setAppPassword(e.target.value)}
        />

        <div className="set-row2" style={{ marginTop: 12 }}>
          <div className="set-row2-info">
            <div className="set-label2">Alert recipients</div>
            <div className="set-sub2">Comma-separated list of email addresses</div>
          </div>
        </div>
        <input
          type="text"
          className="set-field"
          placeholder="alice@company.com, bob@company.com"
          value={recipients}
          onChange={e => setRecipients(e.target.value)}
        />
      </div>

      <div className="settings-actions">
        <button className={`set-save-btn2${saved ? " saved" : ""}`} onClick={handleSave}>
          {saved ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v8M4 6l3 3 3-3M1 11h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Save settings
            </>
          )}
        </button>
        {saveError && (
          <div className="set-error2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 4v4M7 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}