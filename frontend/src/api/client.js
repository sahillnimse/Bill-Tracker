import axios from "axios";
import mockApi from "./mockClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

// Flip to false once the FastAPI backend is running with real credentials
const USE_MOCK = false;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

const realApi = {
  getOverview: (days = 30) =>
    client.get("/overview", { params: { days } }).then((r) => r.data),
  getProvider: (key, days = 30) =>
    client.get(`/provider/${key}`, { params: { days } }).then((r) => r.data),
  syncAll: (days = 30) =>
    client.post("/sync", null, { params: { days } }).then((r) => r.data),
  syncProvider: (key, days = 30) =>
    client.post(`/sync/${key}`, null, { params: { days } }).then((r) => r.data),
  getAnomalies: (provider, limit = 20) =>
    client.get("/anomalies", { params: { provider, limit } }).then((r) => r.data),
  getSettings: () => client.get("/settings").then((r) => r.data),
  updateSettings: (payload) =>
    client.post("/settings", payload).then((r) => r.data),
};

export const api = USE_MOCK ? mockApi : realApi;

export default api;
