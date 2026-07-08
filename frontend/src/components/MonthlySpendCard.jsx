import { useState, useEffect } from "react";
import api from "../api/client";
import { useCurrency } from "../context/CurrencyContext";

function lastThreeMonths() {
  const now = new Date();
  const months = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
  }
  return months;
}

export default function MonthlySpendCard({ providerKey, accent }) {
  const options = lastThreeMonths();
  const [selected, setSelected] = useState(options[0]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const { fmt } = useCurrency();

  useEffect(() => {
    setLoading(true);
    api.getProviderMonthly(providerKey, selected.year, selected.month)
      .then((r) => setTotal(r.total))
      .catch(() => setTotal(null))
      .finally(() => setLoading(false));
  }, [providerKey, selected]);

  return (
    <div className="da-card" data-accent={accent}>
      <div className="da-label">Monthly spend</div>
      <select
        value={`${selected.year}-${selected.month}`}
        onChange={(e) => {
          const opt = options.find((o) => `${o.year}-${o.month}` === e.target.value);
          setSelected(opt);
        }}
        style={{ marginBottom: "6px", background: "transparent", color: "inherit", border: "1px solid var(--border)", borderRadius: "4px", fontSize: "12px" }}
      >
        {options.map((o) => (
          <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
        ))}
      </select>
      <div className="da-val" style={{ color: `var(--${accent})` }}>
        {loading ? "…" : total != null ? fmt(total) : "—"}
      </div>
      <div className="da-sub">{selected.label}</div>
    </div>
  );
}