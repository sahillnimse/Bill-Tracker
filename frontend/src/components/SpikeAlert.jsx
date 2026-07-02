// src/components/SpikeAlert.jsx
import React from "react";
import { useCurrency } from "../context/CurrencyContext";

/**
 * Props:
 *   spike - object with {value, date, type} describing the latest spike or dip
 *   accent - CSS variable for provider color (e.g., "aws")
 */
export default function SpikeAlert({ spike, accent = "aws" }) {
  if (!spike) return null;
  const { fmt } = useCurrency();
  const isSpike = spike.type === "spike";
  const color = isSpike ? "var(--danger)" : "var(--teal)";
  const label = isSpike ? "Spending Spike" : "Spending Dip";
  return (
    <div className="kpi-card" style={{ borderColor: `var(--${accent})` }}>
      <div className="kpi-label" style={{ color: `var(--${accent})` }}>{label}</div>
      <div className="kpi-value" style={{ color }}>{fmt(spike.value)} on {spike.date}</div>
    </div>
  );
}
