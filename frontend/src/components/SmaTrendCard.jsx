// src/components/SmaTrendCard.jsx
import React from "react";
import { useCurrency } from "../context/CurrencyContext";

/**
 * Displays SMA 7 and SMA 15 values with a trend arrow.
 * Props:
 *   sma7 – number (7‑day SMA)
 *   sma15 – number (15‑day SMA)
 *   accent – CSS variable name for the provider color (e.g., "aws")
 */
export default function SmaTrendCard({ sma7, sma15, accent = "aws" }) {
  const { fmt } = useCurrency();
  const trendUp = sma7 > sma15;
  const arrow = trendUp ? "▲" : "▼";
  const arrowColor = trendUp ? "var(--danger)" : "var(--teal)";

  return (
    <div className="kpi-card" style={{ borderColor: `var(--${accent})` }}>
      <div className="kpi-label" style={{ color: `var(--${accent})` }}>
        SMA 7 / SMA 15 {arrow}
      </div>
      <div className="kpi-value" style={{ color: arrowColor }}>
        {fmt(sma7)} / {fmt(sma15)}
      </div>
    </div>
  );
}
