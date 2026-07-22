import { createContext, useContext, useCallback } from "react";

const CurrencyContext = createContext(null);

/**
 * All backend providers return monetary values in INR.
 * No USD conversion is done here — fmt() simply formats the INR value.
 */
export function CurrencyProvider({ children }) {
    // Format an INR amount as a display string with ₹ symbol.
    const fmt = useCallback((inr, opts = {}) => {
        if (inr == null || inr === "—") return "—";
        const num = parseFloat(inr);
        if (isNaN(num)) return String(inr);
        const defaultOpts = { minimumFractionDigits: 0, maximumFractionDigits: 0, ...opts };
        return "₹" + Math.round(num).toLocaleString("en-IN", defaultOpts);
    }, []);

    // Stubs kept for backward-compatibility with any existing consumers.
    // All values are already in INR so convert() is an identity function.
    const convert = useCallback((v) => v, []);
    const toggle = useCallback(() => {}, []);

    return (
        <CurrencyContext.Provider
            value={{
                currency: "INR",
                rate: 1,
                rateLoaded: true,
                toggle,
                convert,
                fmt,
            }}
        >
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency() {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error("useCurrency must be used inside <CurrencyProvider>");
    return ctx;
}