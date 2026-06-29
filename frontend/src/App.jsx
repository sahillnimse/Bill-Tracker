import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Overview from "./pages/Overview";
import AwsPage from "./pages/AwsPage";
import RunPodPage from "./pages/RunPodPage";
import GoogleAnalyticsPage from "./pages/GoogleAnalyticsPage";
import GoogleAdsPage from "./pages/GoogleAdsPage";
import Microsoft365Page from "./pages/Microsoft365Page";
import GoogleWorkspacePage from "./pages/GoogleWorkspacePage";
import SettingsPage from "./pages/SettingsPage";
import { useOverview } from "./hooks/useProviderData";
import { CurrencyProvider } from "./context/CurrencyContext";
import "./App.css";

function badgesFromOverview(overview) {
  if (!overview) return {};
  const badges = {};
  const { providers } = overview;
  if (providers?.runpod?.anomaly?.is_anomaly) badges.runpod = { className: "b-danger", text: "!" };
  if (providers?.ms365?.new_ids_7d > 0) badges.ms = { className: "b-warn", text: `+${providers.ms365.new_ids_7d}` };
  if (providers?.google_ads?.anomaly?.is_anomaly) badges.gads = { className: "b-warn", text: "!" };
  if (providers?.ga4?.anomaly?.is_anomaly) badges.ga = { className: "b-danger", text: "!" };
  if (providers?.aws?.anomaly?.is_anomaly) badges.aws = { className: "b-danger", text: "!" };
  if (providers?.gworkspace?.anomaly?.is_anomaly) badges.gworkspace = { className: "b-warn", text: "!" };
  return badges;
}

function AppShell() {
  const [days, setDays] = useState(30);
  const { data: overview, loading, syncing, error, syncAll, lastSyncedAt } = useOverview(days);
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
        />
        <div className="content">
          <Routes>
            <Route path="/" element={<Overview overview={overview} loading={loading} error={error} />} />
            <Route path="/aws" element={<AwsPage days={days} />} />
            <Route path="/runpod" element={<RunPodPage days={days} />} />
            <Route path="/ga4" element={<GoogleAnalyticsPage days={days} />} />
            <Route path="/google-ads" element={<GoogleAdsPage days={days} />} />
            <Route path="/ms365" element={<Microsoft365Page days={days} />} />
            <Route path="/gworkspace" element={<GoogleWorkspacePage days={days} />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <CurrencyProvider>
        <AppShell />
      </CurrencyProvider>
    </BrowserRouter>
  );
}