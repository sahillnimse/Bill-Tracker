import { useNavigate } from "react-router-dom";
import Sparkline from "../components/Sparkline";
import { useCurrency } from "../context/CurrencyContext";

function pipClass(provider) {
  if (provider?.anomaly?.is_anomaly) return "pip-danger";
  if (provider?._status === "stale" || provider?._status === "error") return "pip-warn";
  return "pip-ok";
}

export default function Overview({ overview, loading, error }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();

  if (loading) return <div className="loading-state">Loading consolidated spend data…</div>;
  if (error) return <div className="error-state">Couldn't load overview: {error}</div>;
  if (!overview) return null;

  const { providers, today_total, month_to_date_total, projected_month_end, active_anomalies } = overview;
  const aws = providers.aws || {};
  const runpod = providers.runpod || {};
  const gads = providers.google_ads || {};
  const ms365 = providers.ms365 || {};

  const topAnomaly = active_anomalies?.[0];
  const providerCount = Object.keys(providers).length;

  const yesterdayTotal = (aws.yesterday || 0) + (runpod.yesterday || 0) + (gads.yesterday || 0);
  const deltaPct = yesterdayTotal > 0
    ? Math.round(((today_total - yesterdayTotal) / yesterdayTotal) * 1000) / 10
    : 0;

  const formattedToday = fmt(today_total);
  const tCcy = formattedToday.match(/^\D+/)?.[0]?.trim() || "";
  const tDigits = formattedToday.replace(/^\D+/, "");
  const [tWhole, tDecimal] = tDigits.split(".");

  const errorProviders = Object.entries(providers)
    .filter(([, p]) => p?._status === "error")
    .map(([name]) => {
      if (name === "google_ads") return "Google Ads";
      if (name === "ms365") return "Microsoft 365";
      if (name === "gworkspace") return "Google Workspace";
      if (name === "aws") return "AWS";
      if (name === "runpod") return "RunPod";
      return name.toUpperCase();
    });

  return (
    <div className="page" id="page-overview">
      {/* HERO LEDGER STRIP */}
      <div className="hero">
        <div className="hero-eyebrow">
          <span className="live-dot"></span>
          Today across {providerCount} providers
        </div>
        <div className="hero-row">
          <div>
            <div className="hero-figure">
              <span className="ccy">{tCcy}</span>
              {tWhole}
              {tDecimal && <span className="cents">.{tDecimal}</span>}
            </div>
            <div className="hero-label">
              vs {fmt(yesterdayTotal)} yesterday
              {yesterdayTotal > 0 && (
                <> · trending {deltaPct >= 0 ? "up" : "down"} {Math.abs(deltaPct)}%</>
              )}
            </div>
          </div>

          <svg className="hero-ekg" viewBox="0 0 300 40" preserveAspectRatio="none">
            <polyline
               points="0,22 30,22 38,8 46,34 54,18 90,18 130,18 138,4 146,30 154,18 220,18 228,10 236,28 244,18 300,18"
               fill="none"
               stroke="var(--amber)"
               strokeWidth="1.5"
               opacity="0.8"
            />
          </svg>

          <div className="hero-stats">
            <div className="hstat">
              <div className="hstat-val">{fmt(month_to_date_total)}</div>
              <div className="hstat-label">Month to date</div>
            </div>
            <div className="hstat">
              <div className="hstat-val" style={{ color: "var(--amber)" }}>{fmt(projected_month_end)}</div>
              <div className="hstat-label">Projected</div>
            </div>
            <div className="hstat">
              <div className="hstat-val" style={{ color: "var(--danger)" }}>{active_anomalies?.length || 0}</div>
              <div className="hstat-label">Anomalies</div>
            </div>
          </div>
        </div>
        <div className="ledger-tick"></div>
      </div>

      {/* ANOMALY STRIP */}
      {topAnomaly && (
        <div className="anomaly-strip">
          <div className="a-icon">!</div>
          <div className="a-text">
            <b>{topAnomaly.provider} spend anomaly detected</b> — {topAnomaly.pct_vs_baseline > 0 ? "+" : ""}{topAnomaly.pct_vs_baseline}% vs baseline of {fmt(topAnomaly.baseline_mean)}/day.
          </div>
          <div className="a-link" onClick={() => navigate(`/${topAnomaly.provider === "google_ads" ? "google-ads" : topAnomaly.provider}`)}>            View history →
          </div>
        </div>
      )}

      {errorProviders.length > 0 && (
        <div className="a-banner" style={{ marginBottom: 24, border: "1px solid rgba(245, 158, 11, 0.3)", background: "linear-gradient(135deg, rgba(245, 158, 11, 0.07), rgba(217, 70, 239, 0.02))" }}>
          <div className="a-icon" style={{ background: "var(--orange)" }}>!</div>
          <div>
            <div className="a-title" style={{ color: "var(--orange)" }}>Provider Connection Notice</div>
            <div className="a-text" style={{ color: "var(--t2)" }}>
              Could not load live data for: {errorProviders.join(", ")}. Showing empty data. Please verify your .env credentials.
            </div>
          </div>
        </div>
      )}

      <div className="grid-label">Providers</div>
      <div className="ov-grid">
        <div className="pcard p-aws" onClick={() => navigate("/aws")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(249,115,22,.12)" }}>☁️</div>
            <div>
              <div className="pc-name">Amazon Web Services</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(aws)}`}></span>
                {aws.anomaly?.is_anomaly ? "Anomaly detected" : `Normal · ${aws.region || "—"}`}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: "var(--aws)" }}>{fmt(aws.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(aws.month_to_date)}</div></div>
            <div><div className="pc-stat-label">vs avg</div><div className="pc-stat-val" style={{ color: aws.anomaly?.is_anomaly ? "var(--danger)" : "var(--ok)" }}>{aws.anomaly?.pct_vs_baseline != null ? `${aws.anomaly.pct_vs_baseline > 0 ? "+" : ""}${aws.anomaly.pct_vs_baseline}%` : "—"}</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={aws.daily_series} color="#f97316" /></div>
        </div>

        <div className="pcard p-runpod" onClick={() => navigate("/runpod")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(232,121,249,.12)" }}>⚡</div>
            <div>
              <div className="pc-name">RunPod</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(runpod)}`}></span>
                {runpod.anomaly?.is_anomaly ? "Anomaly · GPU spike" : "Normal"}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: runpod.anomaly?.is_anomaly ? "var(--danger)" : "var(--t1)" }}>{fmt(runpod.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(runpod.month_to_date)}</div></div>
            <div><div className="pc-stat-label">vs avg</div><div className="pc-stat-val" style={{ color: runpod.anomaly?.is_anomaly ? "var(--danger)" : "var(--ok)" }}>{runpod.anomaly?.pct_vs_baseline != null ? `${runpod.anomaly.pct_vs_baseline > 0 ? "+" : ""}${runpod.anomaly.pct_vs_baseline}%` : "—"}</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={runpod.daily_series} color="#e879f9" /></div>
        </div>


        <div className="pcard p-gads" onClick={() => navigate("/google-ads")}>
          <div className="pc-hdr">
            <div className="pc-icon" style={{ background: "rgba(59,130,246,.12)" }}>📣</div>
            <div>
              <div className="pc-name">Google Ads</div>
              <div className="pc-status">
                <span className={`pip ${pipClass(gads)}`}></span>
                {gads.anomaly?.is_anomaly ? "Anomaly · spend spike" : "Normal"}
              </div>
            </div>
          </div>
          <div className="pc-stats">
            <div><div className="pc-stat-label">Today</div><div className="pc-stat-val" style={{ color: "var(--gads)" }}>{fmt(gads.today)}</div></div>
            <div><div className="pc-stat-label">MTD</div><div className="pc-stat-val">{fmt(gads.month_to_date)}</div></div>
            <div><div className="pc-stat-label">ROAS</div><div className="pc-stat-val" style={{ color: "var(--ok)" }}>{gads.roas ?? "—"}×</div></div>
          </div>
          <div className="pc-spark"><Sparkline series={gads.daily_series} color="#3b82f6" /></div>
        </div>

        <div className="pcard p-ms" onClick={() => navigate("/ms365")} style={{ gridColumn: "span 3" }}>            <div className="pc-hdr" style={{ marginBottom: 0 }}>
          <div className="pc-icon" style={{ background: "rgba(6,182,212,.12)" }}>🪟</div>
          <div>
            <div className="pc-name">Microsoft 365</div>
            <div className="pc-status">
              <span className={`pip ${ms365.new_ids_7d > 0 ? "pip-warn" : "pip-ok"}`}></span>
              {ms365.new_ids_7d > 0 ? `${ms365.new_ids_7d} new IDs this week` : "Stable"}
            </div>
          </div>
        </div>
          <div style={{ display: "flex", gap: 22 }}>
            <div><div className="pc-stat-label">Users</div><div className="pc-stat-val" style={{ color: "var(--ms)" }}>{ms365.total_licenses ?? "—"}</div></div>
            <div><div className="pc-stat-label">Monthly bill</div><div className="pc-stat-val">{fmt(ms365.monthly_bill)}</div></div>
            <div><div className="pc-stat-label">New IDs (7d)</div><div className="pc-stat-val" style={{ color: "var(--warn)" }}>+{ms365.new_ids_7d ?? 0}</div></div>
            <div><div className="pc-stat-label">Cost/user</div><div className="pc-stat-val">{fmt(ms365.cost_per_user)}</div></div>
          </div>
      </div>
    </div>
    </div>
  );
}