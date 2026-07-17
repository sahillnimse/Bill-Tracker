import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { path: "/aws", key: "aws", label: "AWS", color: "var(--aws)", icon: "☁️" },
  { path: "/runpod", key: "runpod", label: "RunPod", color: "var(--runpod)", icon: "⚡" },
  { path: "/google-ads", key: "gads", label: "Google Ads", color: "var(--gads)", icon: "📣" },
  { path: "/ms365", key: "ms", label: "Microsoft 365", color: "var(--ms)", icon: "🪟" },
  { path: "/e2e", key: "e2e", label: "E2E Networks", color: "var(--cyan)", icon: "🚀" },
];

export default function Sidebar({ anomalyCount = 0, providerBadges = {}, collapsed = false, onToggle }) {
  return (
    <nav className={`sb${collapsed ? " sb--collapsed" : ""}`}>
      <div className="sb-head">
        <div className="logo-row">
          <div className="gem">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 18L9 7L13 14L16 9L20 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {!collapsed && (
            <div className="sb-brand">
              <div className="logo-name">SpendWatch</div>
              <div className="logo-sub">Ledger · live</div>
            </div>
          )}
        </div>
      </div>

      {!collapsed && <div className="sb-sec">Overview</div>}
      <NavLink
        to="/"
        end
        className={({ isActive }) => `si c-overview${isActive ? " on" : ""}`}
        title={collapsed ? "All providers" : undefined}
      >
        <div className="si-bar"></div>
        <span style={{ color: "var(--amber)", fontSize: collapsed ? 16 : 12 }}>◆</span>
        {!collapsed && <span>All providers</span>}
        {!collapsed && anomalyCount > 0 && <span className="badge b-danger">{anomalyCount}</span>}
        {collapsed && anomalyCount > 0 && (
          <span className="badge b-danger sb-badge-dot">{anomalyCount}</span>
        )}
      </NavLink>

      <NavLink
        to="/insights"
        className={({ isActive }) => `si c-insights${isActive ? " on" : ""}`}
        title={collapsed ? "Insights" : undefined}
      >
        <div className="si-bar"></div>
        <span style={{ color: "var(--cyan)", fontSize: collapsed ? 16 : 12 }}>✨</span>
        {!collapsed && <span>Insights</span>}
        {!collapsed && anomalyCount > 0 && <span className="badge b-danger">{anomalyCount}</span>}
        {collapsed && anomalyCount > 0 && (
          <span className="badge b-danger sb-badge-dot">{anomalyCount}</span>
        )}
      </NavLink>

      {!collapsed && <div className="sb-sec">Providers</div>}
      {collapsed && <div className="sb-divider" />}
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          className={({ isActive }) => `si c-${item.key}${isActive ? " on" : ""}`}
          title={collapsed ? item.label : undefined}
        >
          <div className="si-bar"></div>
          {collapsed ? (
            <span className="si-icon">{item.icon}</span>
          ) : (
            <>
              <span className="dot" style={{ background: item.color }}></span>
              <span>{item.label}</span>
              {providerBadges[item.key] && (
                <span className={`badge ${providerBadges[item.key].className}`}>
                  {providerBadges[item.key].text}
                </span>
              )}
            </>
          )}
          {collapsed && providerBadges[item.key] && (
            <span className="badge b-danger sb-badge-dot">{providerBadges[item.key].text}</span>
          )}
        </NavLink>
      ))}

      <div className="sb-foot">
        <NavLink
          to="/settings"
          className={({ isActive }) => `si c-settings${isActive ? " on" : ""}`}
          style={{ margin: 0, width: "100%" }}
          title={collapsed ? "Settings" : undefined}
        >
          <div className="si-bar"></div>
          <span style={{ fontSize: collapsed ? 16 : 13 }}>⚙</span>
          {!collapsed && <span>Settings</span>}
        </NavLink>

        <button className="sb-toggle" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .25s" }}
          >
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}