import { createContext, useContext, useState, useEffect, useCallback } from "react";

const CurrencyContext = createContext(null);

const FALLBACK_RATE = 84; // fallback if fetch fails

export function CurrencyProvider({ children }) {
    const [currency, setCurrency] = useState("USD"); // "USD" | "INR"
    const [rate, setRate] = useState(FALLBACK_RATE);
    const [rateLoaded, setRateLoaded] = useState(false);

    // Fetch live USD→INR rate once on mount
    useEffect(() => {
        fetch("https://open.er-api.com/v6/latest/USD")
            .then((r) => r.json())
            .then((d) => {
                const inr = d?.rates?.INR;
                if (inr) setRate(inr);
            })
            .catch(() => { }) // silently use fallback
            .finally(() => setRateLoaded(true));
    }, []);

    const toggle = useCallback(() => {
        setCurrency((c) => (c === "USD" ? "INR" : "USD"));
    }, []);

    // Convert a USD number to the active currency
    const convert = useCallback(
        (usd) => {
            if (currency === "INR") return Math.round(usd * rate);
            return usd;
        },
        [currency, rate]
    );

    // Format a USD number as a display string with the right symbol
    const fmt = useCallback(
        (usd, opts = {}) => {
            if (usd == null || usd === "—") return "—";
            const num = parseFloat(usd);
            if (isNaN(num)) return usd; // pass non-numeric through unchanged
            if (currency === "INR") {
                const inr = Math.round(num * rate);
                return "₹" + inr.toLocaleString("en-IN", opts);
            }
            return "$" + num.toLocaleString("en-US", opts);
        },
        [currency, rate]
    );

    return (
        <CurrencyContext.Provider value={{ currency, rate, rateLoaded, toggle, convert, fmt }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency() {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used inside <CurrencyProvider>");
    return ctx;
}