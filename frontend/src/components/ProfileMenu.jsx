import { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(" ").filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ user, size }) {
    if (user.photo_data_url) {
        return (
            <img
                src={user.photo_data_url}
                alt=""
                style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
            />
        );
    }
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: "var(--ms, #5059c9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: size * 0.4,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
            }}
        >
            {initials(user.name)}
        </div>
    );
}

function DetailRow({ label, value }) {
    if (!value) return null;
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
            <span style={{ fontSize: 11, color: "var(--t3)" }}>{label}</span>
            <span
                style={{
                    fontSize: 11.5,
                    color: "var(--t1)",
                    textAlign: "right",
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
                title={value}
            >
                {value}
            </span>
        </div>
    );
}

export default function ProfileMenu() {
    const { user, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        function handleClick(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    if (!user) return null;

    const hasAnyDetail =
        user.job_title || user.department || user.office_location || user.mobile_phone || user.manager_name || user.employee_id;

    return (
        <div className="range-wrap" ref={ref} style={{ position: "relative" }}>
            <button
                className="range-btn"
                onClick={() => setOpen((o) => !o)}
                title={user.email}
                style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}
            >
                <Avatar user={user} size={22} />
                <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name}
                </span>
            </button>

            {open && (
                <div className="range-menu" style={{ right: 0, left: "auto", minWidth: 280, padding: 0, overflow: "hidden" }}>
                    {/* Header block */}
                    <div style={{ padding: 18, background: "var(--panel2, rgba(255,255,255,0.02))" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 2 }}>
                            <Avatar user={user} size={44} />
                            <div style={{ overflow: "hidden" }}>
                                <div
                                    style={{
                                        fontWeight: 600,
                                        fontSize: 14,
                                        color: "var(--t1)",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {user.name}
                                </div>
                                {user.job_title && (
                                    <div style={{ fontSize: 11.5, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {user.job_title}
                                    </div>
                                )}
                                <div
                                    style={{
                                        fontSize: 10.5,
                                        color: "var(--t3)",
                                        fontFamily: "var(--mono)",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        marginTop: 1,
                                    }}
                                >
                                    {user.email}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Detail grid */}
                    {hasAnyDetail && (
                        <div style={{ padding: "6px 18px", borderTop: "1px solid var(--b1)", borderBottom: "1px solid var(--b1)" }}>
                            <DetailRow label="Department" value={user.department} />
                            <DetailRow label="Office" value={user.office_location} />
                            <DetailRow label="Manager" value={user.manager_name} />
                            <DetailRow label="Mobile" value={user.mobile_phone} />
                            <DetailRow label="Employee ID" value={user.employee_id} />
                        </div>
                    )}
                    {!hasAnyDetail && (
                        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--b1)", borderBottom: "1px solid var(--b1)", fontSize: 11.5, color: "var(--t3)" }}>
                            No additional profile fields set in Azure AD.
                        </div>
                    )}

                    <div style={{ padding: 10 }}>
                        <button
                            className="range-item"
                            onClick={logout}
                            style={{ width: "100%", justifyContent: "center", color: "var(--danger, #f87171)" }}
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}