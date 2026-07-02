import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { path: "/aws", key: "aws", label: "AWS", color: "var(--aws)" },
  { path: "/runpod", key: "runpod", label: "RunPod", color: "var(--runpod)" },
  { path: "/google-ads", key: "gads", label: "Google Ads", color: "var(--gads)" },
  { path: "/gworkspace", key: "gworkspace", label: "Google Workspace", color: "#34a853" },
  { path: "/ms365", key: "ms", label: "Microsoft 365", color: "var(--ms)" },
];

export default function Sidebar({ anomalyCount = 0, providerBadges = {} }) {
  return (
    <nav className="sb">
      <div className="sb-head">
        <div className="logo-row">
          <div className="gem">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 18L9 7L13 14L16 9L20 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="logo-name">SpendWatch</div>
            <div className="logo-sub">Ledger · live</div>
          </div>
        </div>
      </div>

      <div className="sb-sec">Overview</div>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `si c-overview${isActive ? " on" : ""}`}
      >
        <div className="si-bar"></div>
        <span style={{ color: "#818cf8" }}>◆</span>
        <span>All providers</span>
        {anomalyCount > 0 && <span className="badge b-danger">{anomalyCount}</span>}
      </NavLink>

      <div className="sb-sec">Providers</div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          className={({ isActive }) => `si c-${item.key}${isActive ? " on" : ""}`}
        >
          <div className="si-bar"></div>
          <span className="dot" style={{ background: item.color }}></span>
          <span>{item.label}</span>
          {providerBadges[item.key] && (
            <span className={`badge ${providerBadges[item.key].className}`}>
              {providerBadges[item.key].text}
            </span>
          )}
        </NavLink>
      ))}

      <div className="sb-foot">
        <NavLink
          to="/settings"
          className={({ isActive }) => `si c-settings${isActive ? " on" : ""}`}
          style={{ margin: 0, width: "100%" }}
        >
          <div className="si-bar"></div>
          <span>⚙</span>
          <span>Settings</span>
        </NavLink>
      </div>
    </nav>
  );
}