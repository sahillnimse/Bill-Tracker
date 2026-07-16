import { useNavigate } from "react-router-dom";
import Sparkline from "../components/Sparkline";
import AnomalyHistory from "../components/AnomalyHistory";
import { useCurrency } from "../context/CurrencyContext";

function fmtINR(value) {
  if (value === null || value === undefined) return "—";
  return "₹" + Math.round(value).toLocaleString("en-IN");
}

function formatDrivers(drivers, fmt) {
  if (!drivers?.length) return null;
  return drivers
    .map(d => `${d.name} (${d.delta > 0 ? "+" : ""}${fmt(d.delta)}, ${d.pct_vs_baseline > 0 ? "+" : ""}${d.pct_vs_baseline}% vs avg)`)
    .join(", ");
}

function pipClass(provider) {
  if (provider?.anomaly?.is_anomaly) return "pip-danger";
  if (provider?._status === "stale" || provider?._status === "error") return "pip-warn";
  return "pip-ok";
}

const PROVIDER_META = {
  aws:       { icon: "☁️", color: "var(--aws)",    bg: "rgba(255,159,67,0.08)",  label: "Amazon Web Services", route: "/aws" },
  runpod:    { icon: "⚡", color: "var(--runpod)", bg: "rgba(199,107,255,0.08)", label: "RunPod",              route: "/runpod" },
  google_ads:{ icon: "📣", color: "var(--gads)",   bg: "rgba(76,154,255,0.08)",  label: "Google Ads",         route: "/google-ads" },
  ms365:     { icon: "🪟", color: "var(--ms)",     bg: "rgba(0,229,212,0.08)",   label: "Microsoft 365",      route: "/ms365" },
  e2e:       { icon: "🚀", color: "var(--cyan)",   bg: "rgba(0,229,212,0.06)",   label: "E2E Networks",        route: "/e2e" },
};

function ProviderCard({ name, data, onNavigate, fmt, fmtINR }) {
  const meta = PROVIDER_META[name] || {};
  const isAnomaly = data?.anomaly?.is_anomaly;
  const status = isAnomaly ? "Anomaly detected" : data?._status === "error" ? "Connection error" : "Normal";
  const pip = pipClass(data);

  const today = name === "ms365" ? fmtINR(data?.monthly_bill) : name === "e2e" ? fmtINR(data?.today) : fmt(data?.today);
  const mtd   = name === "ms365" ? String(data?.total_licenses ?? "—") + " users" : name === "e2e" ? fmtINR(data?.month_to_date) : fmt(data?.month_to_date);

  const thirdLabel = name === "aws" ? "vs avg" : name === "runpod" ? "vs avg" : name === "google_ads" ? "ROAS" : name === "e2e" ? "Active nodes" : "New IDs 7d";
  const thirdVal   = name === "aws" || name === "runpod"
    ? (data?.anomaly?.pct_vs_baseline != null
        ? `${data.anomaly.pct_vs_baseline > 0 ? "+" : ""}${data.anomaly.pct_vs_baseline}%`
        : "—")
    : name === "google_ads"
    ? (data?.roas != null ? `${data.roas}×` : "—")
    : name === "e2e"
    ? String(data?.active_nodes_count ?? "—")
    : `+${data?.new_ids_7d ?? 0}`;
  const thirdColor = (name === "aws" || name === "runpod") && isAnomaly ? "var(--danger)" : name === "google_ads" ? "var(--ok)" : "var(--warn)";

  const sparkColor = { aws: "#f97316", runpod: "#e879f9", google_ads: "#3b82f6", ms365: "#00E5D4", e2e: "#22d3ee" }[name] || "#888";

  return (
    <div
      className={`pcard2 p-${name === "google_ads" ? "gads" : name === "ms365" ? "ms" : name}${isAnomaly ? " pcard2--anomaly" : ""}`}
      style={{ "--pc-color": meta.color, "--pc-bg": meta.bg }}
      onClick={() => onNavigate(meta.route)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onNavigate(meta.route)}
    >
      <div className="pc2-accent-bar" />
      <div className="pc2-shimmer" />

      <div className="pc2-header">
        <div className="pc2-icon">{meta.icon}</div>
        <div className="pc2-meta">
          <div className="pc2-name">{meta.label}</div>
          <div className="pc2-status">
            <span className={`pip ${pip}`} />
            {status}
          </div>
        </div>
        <svg className="pc2-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div className="pc2-stats">
        <div className="pc2-stat">
          <div className="pc2-stat-label">{name === "ms365" ? "Monthly bill" : "Today"}</div>
          <div className="pc2-stat-val" style={{ color: meta.color }}>{today}</div>
        </div>
        <div className="pc2-stat">
          <div className="pc2-stat-label">{name === "ms365" ? "Users" : "MTD"}</div>
          <div className="pc2-stat-val">{mtd}</div>
        </div>
        <div className="pc2-stat">
          <div className="pc2-stat-label">{thirdLabel}</div>
          <div className="pc2-stat-val" style={{ color: thirdColor }}>{thirdVal}</div>
        </div>
      </div>

      {name !== "ms365" && (
        <div className="pc2-spark">
          <Sparkline series={data?.daily_series} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

export default function Overview({ overview, loading, error }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();

  if (loading) return (
    <div className="page" id="page-overview">
      <div className="skeleton-hero" />
      <div className="ov-grid" style={{ marginTop: 24 }}>
        {[1,2,3,4].map(i => <div key={i} className="skeleton-card" />)}
      </div>
    </div>
  );
  if (error) return <div className="error-state">Couldn't load overview: {error}</div>;
  if (!overview) return null;

  const { providers, today_total, month_to_date_total, projected_month_end, active_anomalies, biggest_mover } = overview;
  const aws   = providers.aws        || {};
  const runpod = providers.runpod    || {};
  const gads  = providers.google_ads || {};

  const topAnomaly = active_anomalies?.[0];
  const providerCount = Object.keys(providers).length;

  const providerLabel = (name) => {
    if (name === "google_ads") return "Google Ads";
    if (name === "ms365") return "Microsoft 365";
    if (name === "aws") return "AWS";
    if (name === "runpod") return "RunPod";
    if (name === "e2e") return "E2E Networks";
    return name;
  };

  const yesterdayTotal = (aws.yesterday || 0) + (runpod.yesterday || 0) + (gads.yesterday || 0);
  const deltaPct = yesterdayTotal > 0
    ? Math.round(((today_total - yesterdayTotal) / yesterdayTotal) * 1000) / 10
    : 0;
  const deltaUp = deltaPct > 0;

  const formattedToday = fmt(today_total);
  const tCcy    = formattedToday.match(/^\D+/)?.[0]?.trim() || "";
  const tDigits = formattedToday.replace(/^\D+/, "");
  const [tWhole, tDecimal] = tDigits.split(".");

  const errorProviders = Object.entries(providers)
    .filter(([, p]) => p?._status === "error")
    .map(([name]) => providerLabel(name));

  return (
    <div className="page" id="page-overview">

      {/* ── HERO ── */}
      <div className="hero2">
        <div className="hero2-bg" />
        <div className="hero2-content">
          <div className="hero2-eyebrow">
            <span className="live-dot" />
            Live · {providerCount} providers
          </div>
          <div className="hero2-figure-row">
            <div>
              <div className="hero2-figure">
                <span className="hero2-ccy">{tCcy}</span>
                {tWhole}
                {tDecimal && <span className="hero2-cents">.{tDecimal}</span>}
              </div>
              <div className="hero2-sublabel">
                Today's total spend
                <span className={`hero2-delta ${deltaUp ? "delta-up" : "delta-dn"}`}>
                  {deltaUp ? "▲" : "▼"} {Math.abs(deltaPct)}% vs yesterday
                </span>
              </div>
            </div>

            <div className="hero2-stats">
              <div className="hero2-stat">
                <div className="hero2-stat-val">{fmt(month_to_date_total)}</div>
                <div className="hero2-stat-label">Month to date</div>
              </div>
              <div className="hero2-stat-div" />
              <div className="hero2-stat">
                <div className="hero2-stat-val" style={{ color: "var(--amber, #FFB020)" }}>{fmt(projected_month_end)}</div>
                <div className="hero2-stat-label">Projected</div>
              </div>
              <div className="hero2-stat-div" />
              <div className="hero2-stat">
                <div className="hero2-stat-val" style={{ color: active_anomalies?.length > 0 ? "var(--danger)" : "var(--ok)" }}>
                  {active_anomalies?.length || 0}
                </div>
                <div className="hero2-stat-label">Anomalies</div>
              </div>
            </div>
          </div>

          {/* EKG line */}
          <svg className="hero2-ekg" viewBox="0 0 400 32" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ekgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0" />
                <stop offset="30%" stopColor="var(--cyan)" stopOpacity="0.7" />
                <stop offset="60%" stopColor="var(--warn)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <polyline
              points="0,18 40,18 52,6 62,28 72,14 120,14 175,14 186,3 196,24 206,14 280,14 292,8 302,22 312,14 400,14"
              fill="none"
              stroke="url(#ekgGrad)"
              strokeWidth="1.8"
            />
          </svg>
        </div>
      </div>

      {/* ── ANOMALY STRIP ── */}
      {topAnomaly && (
        <div className="anomaly-strip2">
          <div className="anomaly-strip2-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L13 12H1L7 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M7 5v3M7 10h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="anomaly-strip2-body">
            <span className="anomaly-strip2-title">{providerLabel(topAnomaly.provider)} anomaly</span>
            {" "}— {topAnomaly.pct_vs_baseline > 0 ? "+" : ""}{topAnomaly.pct_vs_baseline}% vs baseline of {fmt(topAnomaly.baseline_mean)}/day.
            {(() => {
              const drivers = providers?.[topAnomaly.provider]?.anomaly_drivers;
              const text = formatDrivers(drivers, fmt);
              return text ? ` Driven by: ${text}.` : null;
            })()}
            {providers?.[topAnomaly.provider]?.anomaly_explanation && (
              <div className="a-text" style={{ marginTop: 6, opacity: 0.85 }}>
                {providers[topAnomaly.provider].anomaly_explanation}
              </div>
            )}
          </div>
          <button
            className="anomaly-strip2-cta"
            onClick={() => navigate(`/${topAnomaly.provider === "google_ads" ? "google-ads" : topAnomaly.provider}`)}
          >
            Investigate →
          </button>
        </div>
      )}

      {/* ── BIGGEST MOVER STRIP ── */}
      {biggest_mover && (
        <div className="anomaly-strip2" style={{ background: "rgba(6, 182, 212, 0.05)", border: "1px solid rgba(6, 182, 212, 0.15)", color: "var(--t1)", marginTop: 12 }}>
          <div className="anomaly-strip2-icon" style={{ background: "var(--cyan)", color: "#fff" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 11l4-4 3 3 5-7M13 3h-4M13 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="anomaly-strip2-body" style={{ color: "var(--t2)" }}>
            <span className="anomaly-strip2-title" style={{ color: "var(--cyan)", fontWeight: 700 }}>
              {providerLabel(biggest_mover.provider)}
            </span>{" "}
            spend {biggest_mover.pct_change > 0 ? "up" : "down"} {Math.abs(biggest_mover.pct_change)}% this week — biggest mover.
          </div>
          <button
            className="anomaly-strip2-cta"
            style={{ color: "var(--cyan)", borderLeft: "1px solid rgba(6, 182, 212, 0.15)" }}
            onClick={() => navigate(biggest_mover.provider === "google_ads" ? "/google-ads" : `/${biggest_mover.provider}`)}
          >
            Details →
          </button>
        </div>
      )}

      {errorProviders.length > 0 && (
        <div className="info-banner">
          <div className="info-banner-icon">⚠</div>
          <div>
            <div className="info-banner-title">Provider connection issue</div>
            <div className="info-banner-text">
              Could not load live data for: <b>{errorProviders.join(", ")}</b>. Please verify your .env credentials.
            </div>
          </div>
        </div>
      )}

      {/* ── PROVIDERS GRID ── */}
      <div className="ov-section-label">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="6" cy="6" r="2" fill="currentColor"/>
        </svg>
        Providers
      </div>

      <div className="ov-grid2">
        {["aws", "runpod", "google_ads", "ms365", "e2e"].map((key) => (
          <ProviderCard
            key={key}
            name={key}
            data={providers[key] || {}}
            onNavigate={navigate}
            fmt={fmt}
            fmtINR={fmtINR}
          />
        ))}
      </div>

      {active_anomalies && active_anomalies.length > 0 && (
        <div className="ov-anomaly-history" style={{ marginTop: 24 }}>
          <AnomalyHistory
            items={active_anomalies.map((a) => ({
              ...a,
              message: `${providerLabel(a.provider)} — ${a.message}`,
            }))}
          />
        </div>
      )}
    </div>
  );
}