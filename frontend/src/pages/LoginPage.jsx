import { useEffect, useRef, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import "./LoginPage.css";

const ERROR_MESSAGES = {
    access_denied: "Sign-in was cancelled.",
    missing_code: "Microsoft didn't return a valid sign-in code. Please try again.",
    invalid_client: "This app isn't configured correctly with Microsoft yet. Contact the SpendWatch admin.",
    consent_required: "This app needs admin approval before you can sign in. Contact the SpendWatch admin.",
    interaction_required: "Microsoft needs you to complete an extra verification step. Please try again.",
};

function getErrorMessage(code) {
    if (!code) return null;
    return ERROR_MESSAGES[code] || "Sign-in failed. Please try again, or contact the SpendWatch admin if this keeps happening.";
}

const PROVIDERS = [
    { key: "aws", label: "AWS", color: "var(--aws)" },
    { key: "runpod", label: "RunPod", color: "var(--runpod)" },
    { key: "gads", label: "Google Ads", color: "var(--gads)" },
    { key: "ms", label: "Microsoft 365", color: "var(--ms)" },
    { key: "ga", label: "Workspace", color: "var(--ga)" },
];

const STATS = [
    { value: 5, label: "providers tracked", color: "var(--t1)", isNumber: true },
    { value: 1, label: "unified ledger", color: "var(--t1)", isNumber: true },
    { value: "Live", label: "anomaly detection", color: "var(--ok)", isNumber: false },
];

const ACTIVITY_LINES = [
    "AWS Cost Explorer synced",
    "RunPod billing polled",
    "Google Ads spend checked",
    "Microsoft 365 seats verified",
    "Workspace storage scanned",
];

function useCountUp(target, isNumber, durationMs = 700) {
    const [display, setDisplay] = useState(isNumber ? 0 : target);

    useEffect(() => {
        if (!isNumber) {
            setDisplay(target);
            return;
        }
        let raf;
        const start = performance.now();
        function tick(now) {
            const progress = Math.min((now - start) / durationMs, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(Math.round(eased * target));
            if (progress < 1) raf = requestAnimationFrame(tick);
        }
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, isNumber, durationMs]);

    return display;
}

function useRotatingIndex(length, intervalMs = 2600) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
        return () => clearInterval(id);
    }, [length, intervalMs]);
    return index;
}

function ParticleField() {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let raf;
        let particles = [];
        let w = 0;
        let h = 0;

        function resize() {
            w = canvas.parentElement.clientWidth;
            h = canvas.parentElement.clientHeight;
            canvas.width = w * window.devicePixelRatio;
            canvas.height = h * window.devicePixelRatio;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        }

        function init() {
            const count = Math.max(18, Math.floor((w * h) / 24000));
            particles = Array.from({ length: count }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.16,
                vy: (Math.random() - 0.5) * 0.16,
                r: Math.random() * 1.3 + 0.6,
            }));
        }

        function step() {
            ctx.clearRect(0, 0, w, h);
            const linkDist = 120;

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > w) p.vx *= -1;
                if (p.y < 0 || p.y > h) p.vy *= -1;
            }

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const a = particles[i];
                    const b = particles[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < linkDist) {
                        ctx.strokeStyle = `rgba(255, 29, 88, ${0.13 * (1 - dist / linkDist)})`;
                        ctx.lineWidth = 0.6;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
            }

            for (const p of particles) {
                ctx.fillStyle = "rgba(242, 243, 245, 0.32)";
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }

            raf = requestAnimationFrame(step);
        }

        resize();
        init();
        step();

        const onResize = () => {
            resize();
            init();
        };
        window.addEventListener("resize", onResize);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
        };
    }, []);

    return <canvas ref={canvasRef} className="login-particles" />;
}

function StatCard({ stat }) {
    const value = useCountUp(stat.isNumber ? stat.value : 0, stat.isNumber);
    return (
        <div className="login-stat">
            <div className="login-stat-val" style={{ color: stat.color }}>
                {stat.isNumber ? value : stat.value}
            </div>
            <div className="login-stat-label">{stat.label}</div>
        </div>
    );
}

function ActivityTicker() {
    const index = useRotatingIndex(ACTIVITY_LINES.length);
    return (
        <div className="login-ticker">
            <span className="login-ticker-dot" />
            <span className="login-ticker-text" key={index}>{ACTIVITY_LINES[index]}</span>
        </div>
    );
}

function MarketingPanel() {
    return (
        <div className="login-panel login-panel--left">
            <div className="login-panel-grid" />
            <ParticleField />
            <div className="login-glow login-glow-a" />

            <div className="login-panel-content">
                <div className="login-brand-row">
                    <div className="login-mark login-mark--sm">
                        <span className="login-mark-glyph">S</span>
                    </div>
                    <span className="login-brand-name login-brand-name--sm">SpendWatch</span>
                </div>

                <h1 className="login-headline">
                    Every dollar you spend
                    <br />
                    on tools, in one ledger.
                </h1>

                <p className="login-tagline">
                    AWS, RunPod, Google Ads, Microsoft 365, and Google Workspace -
                    tracked live, cross-checked for anomalies, built for Xarka.
                </p>

                <div className="login-providers">
                    {PROVIDERS.map((p, i) => (
                        <div key={p.key} className="login-chip" style={{ animationDelay: `${0.3 + i * 0.07}s` }}>
                            <span className="login-chip-dot" style={{ background: p.color, boxShadow: `0 0 0 3px ${p.color}22` }} />
                            {p.label}
                        </div>
                    ))}
                </div>

                <div className="login-divider" />

                <div className="login-stats">
                    {STATS.map((s) => (
                        <StatCard key={s.label} stat={s} />
                    ))}
                </div>

                <ActivityTicker />
            </div>

            <div className="login-corner-label login-corner-label--left">XARKA AI TECHNOLOGIES</div>
        </div>
    );
}

function SignInPanel() {
    const { login } = useAuth();

    const errorMessage = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return getErrorMessage(params.get("login_error"));
    }, []);

    return (
        <div className="login-panel login-panel--right">
            <div className="login-panel-grid" />
            <div className="login-glow login-glow-b" />
            <div className="login-card">
                <div className="login-card-border" />

                <div className="login-mark">
                    <span className="login-mark-glyph">S</span>
                </div>

                <div className="login-brand">
                    <span className="login-brand-name">Sign in to SpendWatch</span>
                    <span className="login-brand-sub">Use your Xarka Microsoft 365 account to continue.</span>
                </div>

                {errorMessage && (
                    <div className="login-error">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="login-error-icon">
                            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
                            <path d="M7 4v3.5M7 9.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                        <span>{errorMessage}</span>
                    </div>
                )}

                <button className="login-btn" onClick={login}>
                    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
                        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                    </svg>
                    <span>Sign in with Microsoft</span>
                    <svg className="login-btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7h8M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>

                <div className="login-hint">You'll be redirected to Microsoft, then straight to your dashboard.</div>

                <svg className="login-ekg" viewBox="0 0 400 40" preserveAspectRatio="none">
                    <polyline
                        className="login-ekg-line"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points="0,20 40,20 54,20 62,4 70,36 78,20 96,20 120,20 132,20 140,8 148,32 156,20 172,20 400,20"
                    />
                </svg>

                <div className="login-footnote">
                    <span className="login-dot" />
                    Restricted to Xarka's Microsoft 365 organization
                </div>
            </div>

            <div className="login-corner-label login-corner-label--right">SPENDWATCH . INTERNAL</div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <div className="login-screen login-screen--split">
            <MarketingPanel />
            <SignInPanel />
        </div>
    );
}