import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
    const { login } = useAuth();

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg, #0b0b0f)",
            }}
        >
            <div
                style={{
                    width: 380,
                    padding: 40,
                    borderRadius: 16,
                    background: "var(--panel, #14141c)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    textAlign: "center",
                }}
            >
                <div
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: "#FF1D58",
                        margin: "0 auto 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 20,
                        color: "#fff",
                    }}
                >
                    S
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "var(--t1, #fff)", marginBottom: 6 }}>
                    SpendWatch
                </div>
                <div style={{ fontSize: 13, color: "var(--t3, #888)", marginBottom: 28 }}>
                    Internal billing ledger — restricted to Xarka employees
                </div>

                <button
                    onClick={login}
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        padding: "11px 16px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "#fff",
                        color: "#1b1b1b",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 21 21">
                        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                    </svg>
                    Sign in with Microsoft
                </button>

                <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 18 }}>
                    Only accounts on Xarka's Microsoft 365 tenant can access this dashboard.
                </div>
            </div>
        </div>
    );
}