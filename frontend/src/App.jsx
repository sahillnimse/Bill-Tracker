import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Overview from "./pages/Overview";
import AwsPage from "./pages/AwsPage";
import RunPodPage from "./pages/RunPodPage";
import GoogleAdsPage from "./pages/GoogleAdsPage";
import Microsoft365Page from "./pages/Microsoft365Page";
import E2ENetworksPage from "./pages/E2ENetworksPage";
import SettingsPage from "./pages/SettingsPage";
import { useOverview } from "./hooks/useProviderData";
import { CurrencyProvider } from "./context/CurrencyContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ProfileMenu from "./components/ProfileMenu";
import AnomalyToast from "./components/AnomalyToast";
import "./App.css";

function badgesFromOverview(overview) {
  if (!overview) return {};
  const badges = {};
  const keyByProvider = {
    aws: "aws",
    runpod: "runpod",
    google_ads: "gads",
    ms365: "ms",
    e2e: "e2e",
  };
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const a of overview.active_anomalies || []) {
    if (a.date !== todayStr) continue;
    const key = keyByProvider[a.provider];
    if (!key) continue;
    if (!badges[key]) badges[key] = { className: "b-danger", count: 0 };
    badges[key].count += 1;
  }

  const result = {};
  for (const [key, { className, count }] of Object.entries(badges)) {
    result[key] = { className, text: String(count) };
  }

  const newIds = overview.providers?.ms365?.new_ids_7d;
  if (!result.ms && newIds > 0) {
    result.ms = { className: "b-warn", text: `+${newIds}` };
  }

  return result;
}

function AppShell() {
  const [days, setDays] = useState(30);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { data: overview, loading, syncing, error, syncAll, lastSyncedAt, syncVersion } = useOverview(days);
  const location = useLocation();

  useEffect(() => {
    const el = document.querySelector(".content");
    if (el) el.scrollTop = 0;
  }, [location.pathname]);

  const todaysAnomalies = (overview?.active_anomalies || []).filter(
    (a) => a.date === new Date().toISOString().slice(0, 10)
  );
  const anomalyCount = todaysAnomalies.length;
  const providerBadges = badgesFromOverview(overview);

  return (
    <div className={`shell${sidebarCollapsed ? " shell--sb-collapsed" : ""}`}>
      <AnomalyToast anomalies={overview?.active_anomalies || []} />
      <Sidebar
        anomalyCount={anomalyCount}
        providerBadges={providerBadges}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />
      <main className="main">
        <Topbar
          syncedAt={lastSyncedAt}
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
            <Route path="/e2e" element={<E2ENetworksPage days={days} syncVersion={syncVersion} />} />

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