import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import "./LoginPage.css";

function getErrorMessage(message) {
    if (!message) return null;
    return message;
}

/* ---------------------------------------------------------------
   Data used purely for the marketing panel's live ledger illusion.
   Amounts are illustrative — the real numbers live behind login.
---------------------------------------------------------------- */

const PROVIDERS = [
    { key: "aws", label: "AWS", color: "var(--aws)", share: 61 },
    { key: "runpod", label: "RunPod", color: "var(--runpod)", share: 26 },
    { key: "gads", label: "Google Ads", color: "var(--gads)", share: 13 },
    { key: "ms", label: "Microsoft 365", color: "var(--ms)", share: 4 },
    { key: "e2e", label: "E2E Networks", color: "var(--cyan)", share: 1 },
];

const LEDGER_ROWS = [
    { p: "aws", label: "EC2 Cluster • ap-south-1", amt: "••••" },
    { p: "runpod", label: "Serverless GPUs • High Compute", amt: "••••" },
    { p: "gads", label: "Search & Display Campaigns", amt: "••••" },
    { p: "aws", label: "RDS Managed Database", amt: "••••" },
    { p: "ms", label: "Enterprise Workspace Seats", amt: "••••" },
    { p: "aws", label: "NAT Gateway Traffic", amt: "••••" },
    { p: "runpod", label: "GPU Spot Instances", amt: "••••" },
    { p: "gads", label: "Ad Network Placement", amt: "••••" },
    { p: "e2e", label: "Compute Nodes • Regional", amt: "••••" },
    { p: "aws", label: "CloudWatch Telemetry", amt: "••••" },
    { p: "ms", label: "Cloud Workspace Licenses", amt: "••••" },
    { p: "aws", label: "Elastic Load Balancing", amt: "••••" },
];

const TICKER_LINES = [
    "AWS Cost Explorer synced",
    "RunPod billing polled",
    "Google Ads spend checked",
    "Microsoft 365 seats verified",
    "E2E Networks nodes scanned",
    "Anomaly baselines recomputed",
];

/* ------------------------- hooks ------------------------- */

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReduced(mq.matches);
        const fn = (e) => setReduced(e.matches);
        mq.addEventListener("change", fn);
        return () => mq.removeEventListener("change", fn);
    }, []);
    return reduced;
}

function useRotatingIndex(length, intervalMs = 2800) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
        return () => clearInterval(id);
    }, [length, intervalMs]);
    return index;
}

/* --------------------- ambience layers --------------------- */

function ParticleField() {
    const canvasRef = useRef(null);
    const reduced = usePrefersReducedMotion();

    useEffect(() => {
        if (reduced) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let raf, particles = [], w = 0, h = 0;
        let mouse = { x: -1000, y: -1000 };

        function resize() {
            w = canvas.parentElement.clientWidth;
            h = canvas.parentElement.clientHeight;
            canvas.width = w * devicePixelRatio;
            canvas.height = h * devicePixelRatio;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        }

        function init() {
            const count = Math.max(35, Math.floor((w * h) / 18000));
            particles = Array.from({ length: count }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.35,
                vy: (Math.random() - 0.5) * 0.35,
                r: Math.random() * 1.8 + 0.6,
                baseR: Math.random() * 1.8 + 0.6,
            }));
        }

        function step() {
            ctx.clearRect(0, 0, w, h);
            const linkDist = 140;
            const mouseDist = 160;

            for (const p of particles) {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0 || p.x > w) p.vx *= -1;
                if (p.y < 0 || p.y > h) p.vy *= -1;

                // Mouse interaction
                const dx = mouse.x - p.x;
                const dy = mouse.y - p.y;
                const dist = Math.hypot(dx, dy);
                if (dist < mouseDist) {
                    const force = (1 - dist / mouseDist) * 0.4;
                    p.x -= (dx / dist) * force * 3;
                    p.y -= (dy / dist) * force * 3;
                }
            }

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const a = particles[i], b = particles[j];
                    const dx = a.x - b.x, dy = a.y - b.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist < linkDist) {
                        ctx.strokeStyle = `rgba(0, 229, 212, ${0.18 * (1 - dist / linkDist)})`;
                        ctx.lineWidth = 0.8;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }

                // Connect to mouse
                const mDist = Math.hypot(mouse.x - particles[i].x, mouse.y - particles[i].y);
                if (mDist < mouseDist) {
                    ctx.strokeStyle = `rgba(180, 255, 57, ${0.35 * (1 - mDist / mouseDist)})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                }
            }

            for (const p of particles) {
                ctx.fillStyle = "rgba(244, 246, 251, 0.45)";
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            raf = requestAnimationFrame(step);
        }

        const handleMouseMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            mouse.x = e.clientX - rect.left;
            mouse.y = e.clientY - rect.top;
        };

        const handleMouseLeave = () => {
            mouse.x = -1000;
            mouse.y = -1000;
        };

        resize(); init(); step();
        const onResize = () => { resize(); init(); };
        window.addEventListener("resize", onResize);
        window.addEventListener("mousemove", handleMouseMove);
        document.body.addEventListener("mouseleave", handleMouseLeave);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("mousemove", handleMouseMove);
            document.body.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, [reduced]);

    return <canvas ref={canvasRef} className="lp-particles" aria-hidden="true" />;
}

function AuroraBackdrop() {
    return (
        <div className="lp-aurora" aria-hidden="true">
            <div className="lp-aurora-blob lp-aurora-a" />
            <div className="lp-aurora-blob lp-aurora-b" />
            <div className="lp-aurora-blob lp-aurora-c" />
            <div className="lp-aurora-blob lp-aurora-d" />
            <div className="lp-grid-lines" />
            <ParticleField />
            <div className="lp-scanline" />
            <div className="lp-noise" />
        </div>
    );
}

/* Animated spend pulse drawn behind the headline. */
function PulseLine() {
    const canvasRef = useRef(null);
    const reduced = usePrefersReducedMotion();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let raf;
        let w = 0;
        let h = 0;
        let t = 0;

        function resize() {
            w = canvas.parentElement.clientWidth;
            h = canvas.parentElement.clientHeight;
            canvas.width = w * devicePixelRatio;
            canvas.height = h * devicePixelRatio;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        }

        function wave(x, phase, amp, freq) {
            return (
                Math.sin(x * freq + phase) * amp +
                Math.sin(x * freq * 2.3 + phase * 1.6) * amp * 0.35
            );
        }

        function draw() {
            ctx.clearRect(0, 0, w, h);
            const baseY = h * 0.62;
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, "rgba(0,229,212,0)");
            grad.addColorStop(0.25, "rgba(0,229,212,0.6)");
            grad.addColorStop(0.75, "rgba(180,255,57,0.55)");
            grad.addColorStop(1, "rgba(180,255,57,0)");

            ctx.beginPath();
            for (let x = 0; x <= w; x += 3) {
                const y = baseY + wave(x, t, 14, 0.012);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.8;
            ctx.stroke();

            // faint echo line
            ctx.beginPath();
            for (let x = 0; x <= w; x += 4) {
                const y = baseY + 18 + wave(x, t * 0.7 + 2, 10, 0.010);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = "rgba(142,151,175,0.18)";
            ctx.lineWidth = 1;
            ctx.stroke();

            t += 0.018;
            raf = requestAnimationFrame(draw);
        }

        resize();
        if (reduced) {
            t = 3;
            const once = () => {
                draw();
                cancelAnimationFrame(raf);
            };
            once();
        } else {
            draw();
        }
        const onResize = () => resize();
        window.addEventListener("resize", onResize);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
        };
    }, [reduced]);

    return <canvas ref={canvasRef} className="lp-pulse" aria-hidden="true" />;
}

/* ------------------ signature: live ledger ------------------ */

function providerColor(key) {
    const p = PROVIDERS.find((x) => x.key === key);
    return p ? p.color : "var(--t3)";
}

function LedgerTape() {
    const rows = useMemo(() => [...LEDGER_ROWS, ...LEDGER_ROWS], []);
    return (
        <div className="lp-ledger" role="presentation">
            <div className="lp-ledger-head">
                <span className="lp-ledger-dot lp-ledger-dot--r" />
                <span className="lp-ledger-dot lp-ledger-dot--y" />
                <span className="lp-ledger-dot lp-ledger-dot--g" />
                <span className="lp-ledger-title">spendwatch / live.ledger</span>
                <span className="lp-ledger-live">
                    <span className="lp-live-pulse" />
                    LIVE
                </span>
            </div>
            <div className="lp-ledger-cols">
                <span>provider</span>
                <span>line item</span>
                <span className="lp-num">amount / day</span>
            </div>
            <div className="lp-ledger-viewport">
                <div className="lp-ledger-scroll">
                    {rows.map((r, i) => (
                        <div className="lp-ledger-row" key={i}>
                            <span className="lp-ledger-rail" style={{ background: providerColor(r.p) }} />
                            <span className="lp-ledger-provider" style={{ color: providerColor(r.p) }}>
                                {PROVIDERS.find((x) => x.key === r.p)?.label}
                            </span>
                            <span className="lp-ledger-item">{r.label}</span>
                            <span className="lp-ledger-amt lp-masked">
                                <span className="lp-blur-text">₹99,999</span>
                                <span className="lp-lock-badge">🔒 Hidden</span>
                            </span>
                        </div>
                    ))}
                </div>
                <div className="lp-ledger-fade lp-ledger-fade--top" />
                <div className="lp-ledger-fade lp-ledger-fade--bottom" />
            </div>
        </div>
    );
}

function ProviderRail() {
    return (
        <div className="lp-rail">
            {PROVIDERS.map((p, i) => (
                <div className="lp-rail-item" key={p.key} style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
                    <div className="lp-rail-top">
                        <span className="lp-rail-dot" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                        <span className="lp-rail-label">{p.label}</span>
                        <span className="lp-rail-share lp-num">{p.share}%</span>
                    </div>
                    <div className="lp-rail-bar">
                        <div
                            className="lp-rail-fill"
                            style={{ width: `${p.share}%`, background: p.color, animationDelay: `${0.7 + i * 0.08}s` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function ActivityTicker() {
    const index = useRotatingIndex(TICKER_LINES.length);
    return (
        <div className="lp-ticker" aria-live="polite">
            <span className="lp-ticker-pulse" />
            <span className="lp-ticker-text" key={index}>
                {TICKER_LINES[index]}
            </span>
        </div>
    );
}

function use3dTilt() {
    const cardRef = useRef(null);

    useEffect(() => {
        const card = cardRef.current;
        if (!card) return;

        const handleMouseMove = (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const rotateX = ((y - centerY) / centerY) * -6;
            const rotateY = ((x - centerX) / centerX) * 6;

            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(8px)`;
            card.style.setProperty("--mouse-x", `${x}px`);
            card.style.setProperty("--mouse-y", `${y}px`);
        };

        const handleMouseLeave = () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)`;
        };

        card.addEventListener("mousemove", handleMouseMove);
        card.addEventListener("mouseleave", handleMouseLeave);

        return () => {
            card.removeEventListener("mousemove", handleMouseMove);
            card.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, []);

    return cardRef;
}

/* ---------------------- sign in panel ---------------------- */

function SignInPanel() {
    const { login, enrollStart, enrollConfirm } = useAuth();
    const cardRef = use3dTilt();

    // stage: "email" | "qr" | "code" | "submitting"
    const [stage, setStage] = useState("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    const handleEmailSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setStage("submitting");
        try {
            const result = await enrollStart(email);
            if (result.enrolled) {
                setStage("code");
            } else {
                setQrDataUrl(result.qr_code_data_url);
                setStage("qr");
            }
        } catch (err) {
            setErrorMessage(getErrorMessage(err?.response?.data?.detail) || "Something went wrong. Please try again.");
            setStage("email");
        }
    };

    const handleQrContinue = () => {
        setStage("code");
    };

    const handleCodeSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setStage("submitting");
        try {
            if (qrDataUrl) {
                await enrollConfirm(email, code);
            } else {
                await login(email, code);
            }
        } catch (err) {
            setErrorMessage(getErrorMessage(err?.response?.data?.detail) || "Incorrect code. Please try again.");
            setStage("code");
        }
    };

    const stepIndex = stage === "email" || (stage === "submitting" && !qrDataUrl && code === "") ? 0 : stage === "qr" ? 1 : 2;

    return (
        <div className="lp-card lp-reveal" ref={cardRef} style={{ animationDelay: "0.2s" }}>
            <div className="lp-card-sheen" aria-hidden="true" />
            <div className="lp-card-spotlight" aria-hidden="true" />

            <div className="lp-card-mark">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                    <path d="M3 16 8 9l4 4 5-8 4 6" stroke="#0A0D16" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>

            <h2 className="lp-card-title">Sign in to SpendWatch</h2>
            <p className="lp-card-sub">
                {stage === "qr"
                    ? "Scan this into Microsoft Authenticator to finish setup."
                    : stepIndex === 2
                        ? "Enter the 6-digit code from your authenticator app."
                        : "Enter your authorized work email to continue."}
            </p>

            <div className="lp-steps" aria-hidden="true">
                {["Email", "Verify", "Code"].map((label, i) => (
                    <div key={label} className={`lp-step ${i <= stepIndex ? "is-active" : ""}`}>
                        <span className="lp-step-bar" />
                        <span className="lp-step-label">{label}</span>
                    </div>
                ))}
            </div>

            {errorMessage && (
                <div className="lp-error" role="alert">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M7 4v3.5M7 9.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <span>{errorMessage}</span>
                </div>
            )}

            {stage === "email" || (stage === "submitting" && !qrDataUrl && code === "") ? (
                <form onSubmit={handleEmailSubmit} className="lp-form" key="email">
                    <label className="lp-field">
                        <span className="lp-field-label">Work email</span>
                        <input
                            className="lp-input"
                            type="email"
                            required
                            placeholder="you@xarka.in"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={stage === "submitting"}
                            autoFocus
                        />
                    </label>
                    <button className="lp-btn" type="submit" disabled={stage === "submitting"}>
                        <span>{stage === "submitting" ? "Checking…" : "Continue"}</span>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M3 8h9M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </form>
            ) : null}

            {stage === "qr" && (
                <div className="lp-qr" key="qr">
                    <div className="lp-qr-frame">
                        <img src={qrDataUrl} alt="Scan with Microsoft Authenticator" className="lp-qr-img" />
                    </div>
                    <button className="lp-btn" onClick={handleQrContinue}>
                        <span>I've scanned it — continue</span>
                    </button>
                </div>
            )}

            {(stage === "code" || (stage === "submitting" && (qrDataUrl || code !== ""))) && (
                <form onSubmit={handleCodeSubmit} className="lp-form" key="code">
                    <label className="lp-field">
                        <span className="lp-field-label">Authenticator code</span>
                        <input
                            className="lp-input lp-input--code lp-num"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            placeholder="••••••"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            disabled={stage === "submitting"}
                            autoFocus
                        />
                    </label>
                    <button className="lp-btn" type="submit" disabled={stage === "submitting"}>
                        <span>{stage === "submitting" ? "Verifying…" : "Sign in"}</span>
                    </button>
                </form>
            )}

            <div className="lp-footnote">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M6 1 10 3v3c0 2.6-1.7 4.3-4 5-2.3-.7-4-2.4-4-5V3l4-2Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                </svg>
                Restricted access · MFA enforced
            </div>
        </div>
    );
}

/* ---------------------- main layout ---------------------- */

export default function LoginPage() {
    return (
        <div className="lp-screen">
            <AuroraBackdrop />

            <div className="lp-container">
                {/* Header Navbar */}
                <header className="lp-header lp-reveal" style={{ animationDelay: "0.05s" }}>
                    <div className="lp-brand-row">
                        <div className="lp-mark">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                                <path d="M3 16 8 9l4 4 5-8 4 6" stroke="#0A0D16" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <div className="lp-brand-text">
                            <span className="lp-brand-name">SpendWatch</span>
                            <span className="lp-brand-sub">CLOUD COST INTELLIGENCE</span>
                        </div>
                    </div>
                    <div className="lp-header-badge">
                        <span className="lp-live-pulse" />
                        <span>ENTERPRISE LEDGER LIVE</span>
                    </div>
                </header>

                {/* Hero Headline Section */}
                <div className="lp-hero-center">
                    <PulseLine />
                    <h1 className="lp-headline lp-reveal" style={{ animationDelay: "0.15s" }}>
                        Every rupee your cloud burns,
                        <br />
                        <span className="lp-headline-accent">accounted for.</span>
                    </h1>
                    
                    <div className="lp-mtd lp-reveal" style={{ animationDelay: "0.25s" }}>
                        <div className="lp-mtd-value-wrapper">
                            <span className="lp-mtd-label">TOTAL MONTHLY SPEND</span>
                            <span className="lp-mtd-value lp-blur-val">₹••,•••</span>
                            <span className="lp-protected-pill">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                                Sign in to view live spend
                            </span>
                        </div>
                    </div>
                </div>

                {/* Unified Main Content Grid */}
                <div className="lp-main-grid">
                    {/* Left Feature Column */}
                    <div className="lp-feature-col lp-reveal" style={{ animationDelay: "0.35s" }}>
                        <LedgerTape />
                        <div className="lp-side-col">
                            <ProviderRail />
                            <ActivityTicker />
                        </div>
                    </div>

                    {/* Right Auth Card Column */}
                    <div className="lp-auth-col">
                        <SignInPanel />
                    </div>
                </div>

                {/* Footer */}
                <footer className="lp-footer lp-reveal" style={{ animationDelay: "0.45s" }}>
                    <span>SPENDWATCH ENTERPRISE · SECURE AUTHENTICATION</span>
                    <span className="lp-footer-dot">•</span>
                    <span>AWS · RUNPOD · GOOGLE ADS · MS 365 · E2E NETWORKS</span>
                </footer>
            </div>
        </div>
    );
}