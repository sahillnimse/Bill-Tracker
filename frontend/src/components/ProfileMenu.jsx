import { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(" ").filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

    return (
        <div className="range-wrap" ref={ref} style={{ position: "relative" }}>
            <button
                className="range-btn"
                onClick={() => setOpen((o) => !o)}
                title={user.email}
                style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}
            >
                {user.photo_data_url ? (
                    <img
                        src={user.photo_data_url}
                        alt=""
                        style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }}
                    />
                ) : (
                    <div
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "var(--ms, #5059c9)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#fff",
                        }}
                    >
                        {initials(user.name)}
                    </div>
                )}
                <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name}
                </span>
            </button>

            {open && (
                <div className="range-menu" style={{ right: 0, left: "auto", minWidth: 240, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        {user.photo_data_url ? (
                            <img
                                src={user.photo_data_url}
                                alt=""
                                style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "var(--ms, #5059c9)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 14,
                                    fontWeight: 700,
                                    color: "#fff",
                                }}
                            >
                                {initials(user.name)}
                            </div>
                        )}
                        <div style={{ overflow: "hidden" }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {user.name}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {user.email}
                            </div>
                        </div>
                    </div>

                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, marginBottom: 10 }}>
                        {user.job_title && (
                            <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 4 }}>
                                <span style={{ color: "var(--t3)" }}>Title: </span>{user.job_title}
                            </div>
                        )}
                        {user.department && (
                            <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 4 }}>
                                <span style={{ color: "var(--t3)" }}>Department: </span>{user.department}
                            </div>
                        )}
                        {user.office_location && (
                            <div style={{ fontSize: 12, color: "var(--t2)" }}>
                                <span style={{ color: "var(--t3)" }}>Office: </span>{user.office_location}
                            </div>
                        )}
                        {!user.job_title && !user.department && !user.office_location && (
                            <div style={{ fontSize: 12, color: "var(--t3)" }}>No additional profile fields set in Azure AD.</div>
                        )}
                    </div>

                    <button
                        className="range-item"
                        onClick={logout}
                        style={{ width: "100%", justifyContent: "center", color: "var(--danger, #f87171)" }}
                    >
                        Sign out
                    </button>
                </div>
            )}
        </div>
    );
}