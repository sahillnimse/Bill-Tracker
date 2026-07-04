import { useState, useRef, useEffect } from "react";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
];

export default function Topbar({ syncedAt, onSync, syncing, days, onDaysChange }) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef(null);

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

  useEffect(() => {
    // Auto sync on mount and when days change
    onSync();
  }, [onSync, days]);
  return (
    <div className="topbar">
      <div style={{ display: "flex", gap: 3, alignItems: "center" }} />
      <div className="tb-r">
        <span className="sync-time">
          {syncing ? "Syncing…" : `Synced ${formattedTime}`}
        </span>

        {/* ── Currency indicator (always INR — conversion disabled) ── */}
        <button
          className="range-btn range-btn--disabled"
          disabled
          title="INR pricing is hardcoded for Microsoft 365 — conversion disabled"
          style={{ minWidth: 72, fontVariantNumeric: "tabular-nums" }}
        >
          ₹ INR
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
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
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
                      <path d="M2 6l3 3 5-5" stroke="#818cf8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}