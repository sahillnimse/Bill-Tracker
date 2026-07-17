import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useCurrency } from "../context/CurrencyContext";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
];

const PAGE_LABELS = {
  "/": "Dashboard",
  "/aws": "Amazon Web Services",
  "/runpod": "RunPod",
  "/google-ads": "Google Ads",
  "/ms365": "Microsoft 365",
  "/e2e": "E2E Networks",
  "/settings": "Settings",
};

export default function Topbar({ syncedAt, days, onDaysChange, children }) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef(null);
  const { currency, toggle, rate, rateLoaded } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();

  const isRoot = location.pathname === "/";
  const pageLabel = PAGE_LABELS[location.pathname];

  const formattedTime = syncedAt
    ? new Date(syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "—";

  const selectedLabel = RANGES.find((r) => r.days === days)?.label ?? "1 month";

  useEffect(() => {
    function handleClick(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="topbar">
      <div className="tb-l">
        {!isRoot && (
          <button className="back-btn" onClick={() => navigate(-1)} title="Go back">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        )}
        {pageLabel && (
          <span className="tb-breadcrumb">
            <span className="tb-bc-sep">{!isRoot && "/"}</span>
            {pageLabel}
          </span>
        )}
      </div>

      <div className="tb-r">
        <span className="sync-time">
          Synced {formattedTime}
        </span>

        {/* ── Currency toggle ── */}
        <button
          className="range-btn"
          onClick={toggle}
          title={
            rateLoaded
              ? `1 USD = ₹${rate.toFixed(2)} · click to switch`
              : "Loading exchange rate…"
          }
          style={{ minWidth: 72, fontVariantNumeric: "tabular-nums" }}
        >
          {currency === "USD" ? "$ USD" : "₹ INR"}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5 1v8M2 4l3-3 3 3M2 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* ── Time-range dropdown ── */}
        <div className="range-wrap" ref={dropRef}>
          <button
            className="range-btn"
            onClick={() => setOpen((o) => !o)}
            title="Change time range"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <rect x="1" y="2" width="10" height="1.2" rx=".6" fill="currentColor" opacity=".6" />
              <rect x="1" y="5.4" width="7" height="1.2" rx=".6" fill="currentColor" opacity=".6" />
              <rect x="1" y="8.8" width="5" height="1.2" rx=".6" fill="currentColor" opacity=".6" />
            </svg>
            {selectedLabel}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: "transform .2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
              <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {open && (
            <div className="range-menu">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  className={`range-item${r.days === days ? " on" : ""}`}
                  onClick={() => {
                    onDaysChange(r.days);
                    setOpen(false);
                  }}
                >
                  {r.label}
                  {r.days === days && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}