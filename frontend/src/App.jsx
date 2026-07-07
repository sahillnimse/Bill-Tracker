import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Overview from "./pages/Overview";
import AwsPage from "./pages/AwsPage";
import RunPodPage from "./pages/RunPodPage";
import GoogleAdsPage from "./pages/GoogleAdsPage";
import Microsoft365Page from "./pages/Microsoft365Page";
import GoogleWorkspacePage from "./pages/GoogleWorkspacePage";
import SettingsPage from "./pages/SettingsPage";
import { useOverview } from "./hooks/useProviderData";
import { CurrencyProvider } from "./context/CurrencyContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ProfileMenu from "./components/ProfileMenu";
import "./App.css";

function badgesFromOverview(overview) {
  if (!overview) return {};
  const badges = {};
  const { providers } = overview;
  if (providers?.runpod?.anomaly?.is_anomaly) badges.runpod = { className: "b-danger", text: "!" };
  if (providers?.ms365?.new_ids_7d > 0) badges.ms = { className: "b-warn", text: `+${providers.ms365.new_ids_7d}` };
  if (providers?.google_ads?.anomaly?.is_anomaly) badges.gads = { className: "b-warn", text: "!" };
  if (providers?.aws?.anomaly?.is_anomaly) badges.aws = { className: "b-danger", text: "!" };
  if (providers?.gworkspace?.anomaly?.is_anomaly) badges.gworkspace = { className: "b-warn", text: "!" };
  return badges;
}

function AppShell() {
  const [days, setDays] = useState(30);
  const { data: overview, loading, syncing, error, syncAll, lastSyncedAt, syncVersion } = useOverview(days);
  const location = useLocation();

  useEffect(() => {
    const el = document.querySelector(".content");
    if (el) el.scrollTop = 0;
  }, [location.pathname]);

  const anomalyCount = overview?.active_anomalies?.length || 0;
  const providerBadges = badgesFromOverview(overview);

  return (
    <div className="shell">
      <Sidebar anomalyCount={anomalyCount} providerBadges={providerBadges} />
      <main className="main">
        <Topbar
          syncedAt={lastSyncedAt}
          onSync={syncAll}
          syncing={syncing}
          days={days}
          onDaysChange={setDays}
        >
          <ProfileMenu />
        </Topbar>
        <div className="content">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Overview overview={overview} loading={loading} error={error} />} />
            <Route path="/aws" element={<AwsPage days={days} syncVersion={syncVersion} />} />
            <Route path="/runpod" element={<RunPodPage days={days} syncVersion={syncVersion} />} />
            <Route path="/google-ads" element={<GoogleAdsPage days={days} syncVersion={syncVersion} />} />
            <Route path="/ms365" element={<Microsoft365Page days={days} syncVersion={syncVersion} />} />
            <Route path="/gworkspace" element={<GoogleWorkspacePage days={days} syncVersion={syncVersion} />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function Gate() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3, #888)" }}>
        Checking session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <CurrencyProvider>
      <AppShell />
    </CurrencyProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}