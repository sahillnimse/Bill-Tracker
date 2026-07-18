import axios from "axios";
// No mock API import – using real FastAPI backend

// API base URL configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";


const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 500000,
  withCredentials: true, // send/receive the session cookie set by /api/auth/callback
});

const realApi = {
  getOverview: (days = 30) =>
    client.get("/overview", { params: { days } }).then((r) => r.data),
  getProvider: (key, days = 30) =>
    client.get(`/provider/${key}`, { params: { days } }).then((r) => r.data),
  getProviderMonthly: (key, year, month) =>
    client.get(`/provider/${key}/monthly`, { params: { year, month } }).then((r) => r.data),
  syncAll: (days = 30) =>
    client.post("/sync", null, { params: { days } }).then((r) => r.data),
  syncProvider: (key, days = 30) =>
    client.post(`/sync/${key}`, null, { params: { days } }).then((r) => r.data),
  getAnomalies: (provider, limit = 20) =>
    client.get("/anomalies", { params: { provider, limit } }).then((r) => r.data),
  getInsights: (days = 30) =>
    client.get("/insights", { params: { days } }).then((r) => r.data),
  getSettings: () => client.get("/settings").then((r) => r.data),
  updateSettings: (payload) =>
    client.post("/settings", payload).then((r) => r.data),
  getAwsInstances: () => client.get("/aws/instances").then((r) => r.data),
  getAwsUsageBreakdown: (days = 30) =>
    client.get("/aws/usage-breakdown", { params: { days } }).then((r) => r.data),
  getAwsWasteScan: () => client.get("/aws/waste-scan").then((r) => r.data),
  getAwsCostByTag: (tagKey = "Project", days = 30) =>
    client.get("/aws/cost-by-tag", { params: { tag_key: tagKey, days } }).then((r) => r.data),
  getAwsRecordTypes: (days = 30) =>
    client.get("/aws/record-types", { params: { days } }).then((r) => r.data),
  getAwsSpRecommendation: () => client.get("/aws/sp-recommendation").then((r) => r.data),
  getRunpodUtilization: () => client.get("/runpod/utilization").then((r) => r.data),
  getRunpodCostComponents: (days = 30) =>
    client.get("/runpod/cost-components", { params: { days } }).then((r) => r.data),
  getGadsSearchTerms: () => client.get("/gads/search-terms").then((r) => r.data),
  getGadsDevices: () => client.get("/gads/devices").then((r) => r.data),
  getGadsGeo: () => client.get("/gads/geo").then((r) => r.data),
  getGadsHourly: () => client.get("/gads/hourly").then((r) => r.data),
  getGadsBudgetPacing: () => client.get("/gads/budget-pacing").then((r) => r.data),
  getMs365Storage: () => client.get("/ms365/storage").then((r) => r.data),
  getMs365Activity: () => client.get("/ms365/activity").then((r) => r.data),
  getE2eResources: () => client.get("/e2e/resources").then((r) => r.data),
  getMe: () => client.get("/auth/me").then((r) => r.data),
  logout: () => client.post("/auth/logout").then((r) => r.data),
  enrollStart: (email) => client.post("/auth/enroll/start", { email }).then((r) => r.data),
  enrollConfirm: (email, code) => client.post("/auth/enroll/confirm", { email, code }).then((r) => r.data),
  login: (email, code) => client.post("/auth/login", { email, code }).then((r) => r.data),
};

export const api = realApi;

export default api;