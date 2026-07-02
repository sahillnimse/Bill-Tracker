// src/components/BudgetProgressBar.jsx
import React from "react";

/**
 * Props:
 *   budget - total monthly budget (number)
 *   spent  - amount spent month‑to‑date (number)
 *   accent - CSS variable name for provider color (e.g., "aws")
 */
export default function BudgetProgressBar({ budget, spent, accent = "aws" }) {
  const percent = Math.min(100, (spent / budget) * 100);
  const getColor = () => {
    if (percent < 80) return "var(--teal)";
    if (percent < 95) return "var(--orange)";
    return "var(--danger)";
  };
  return (
    <div className="kpi-card" style={{ borderColor: `var(--${accent})` }}>
      <div className="kpi-label" style={{ color: `var(--${accent})` }}>
        Budget usage
      </div>
      <div className="kpi-value">{spent.toFixed(2)} / {budget}</div>
      <div
        style={{
          height: "8px",
          borderRadius: "4px",
          background: "var(--bg-card)",
          marginTop: "4px",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: getColor(),
            borderRadius: "4px",
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  );
}
