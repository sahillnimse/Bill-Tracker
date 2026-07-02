// src/components/MonthlyForecastCard.jsx
import React from "react";
import { useCurrency } from "../context/CurrencyContext";

/**
 * Props:
 *   forecast – projected spend for the month (number)
 *   accent – CSS variable for provider color (e.g., "aws")
 */
export default function MonthlyForecastCard({ forecast, accent = "aws" }) {
  const { fmt } = useCurrency();
  return (
    <div className="kpi-card" style={{ borderColor: `var(--${accent})` }}>
      <div className="kpi-label" style={{ color: `var(--${accent})` }}>
        Forecasted spend
      </div>
      <div className="kpi-value">{fmt(forecast)}</div>
    </div>
  );
}
