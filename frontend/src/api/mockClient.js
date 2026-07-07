/**
 * Mock data layer — stands in for the FastAPI backend's /api responses.
 * Mirrors the exact shape main.py will return, so swapping this file's
 * exports for real axios calls later (see api/client.js) requires no
 * changes to any page component.
 */

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildDailySeries(days, base, variance, spikeIndex, spikeMultiplier, seed) {
  const rand = seededRandom(seed);
  const series = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    let value = base + (rand() - 0.5) * variance;
    const dayIndexFromEnd = days - 1 - i;
    if (spikeIndex >= 0 && dayIndexFromEnd === spikeIndex) {
      value *= spikeMultiplier;
    }
    series.push({ date: d.toISOString().slice(0, 10), value: Math.round(value * 100) / 100 });
  }
  return series;
}

function zScoreOf(series, baselineWindow = 14) {
  const values = series.map((d) => d.value);
  const today = values[values.length - 1];
  const baseline = values.slice(0, -1).slice(-baselineWindow);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const stdev = Math.sqrt(variance);
  const z = stdev > 0 ? (today - mean) / stdev : 0;
  const delta = today - mean;
  const pct = mean > 0 ? (delta / mean) * 100 : 0;
  const isAnomaly = Math.abs(z) >= 2.0 && Math.abs(delta) >= 5;
  return {
    is_anomaly: isAnomaly,
    z_score: Math.round(z * 100) / 100,
    baseline_mean: Math.round(mean * 100) / 100,
    baseline_stdev: Math.round(stdev * 100) / 100,
    today_value: Math.round(today * 100) / 100,
    pct_vs_baseline: Math.round(pct * 10) / 10,
    delta: Math.round(delta * 100) / 100,
    severity: isAnomaly ? (z >= 3 ? "danger" : "warn") : "ok",
  };
}

function mtd(series) {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  return Math.round(series.filter((d) => d.date.startsWith(monthPrefix)).reduce((a, b) => a + b.value, 0) * 100) / 100;
}

// ---------- AWS ----------
function getAwsMock() {
  const series = buildDailySeries(30, 400, 60, -1, 1, 1);
  const anomaly = zScoreOf(series);
  return {
    provider: "aws",
    today: series[series.length - 1].value,
    yesterday: series[series.length - 2].value,
    month_to_date: mtd(series),
    avg_per_day_30d: Math.round((series.reduce((a, b) => a + b.value, 0) / series.length) * 100) / 100,
    daily_series: series,
    services: [
      { name: "EC2", amount: 210, pct: 51 },
      { name: "S3", amount: 98, pct: 24 },
      { name: "RDS", amount: 72, pct: 17 },
      { name: "CloudFront", amount: 18, pct: 4 },
      { name: "Lambda", amount: 11, pct: 3 },
    ],
    anomaly,
    region: "us-east-1",
    _status: "mock",
  };
}

// ---------- RunPod ----------
function getRunpodMock() {
  const series = buildDailySeries(30, 220, 40, 0, 2.9, 2);
  const anomaly = zScoreOf(series);
  return {
    provider: "runpod",
    today: series[series.length - 1].value,
    active_pods_count: 3,
    gpu_hours_today: 58.4,
    month_to_date: mtd(series),
    daily_series: series,
    pods: [
      { id: "p1", name: "A100 80GB × 4", status: "RUNNING", cost_per_hr: 2.89, uptime_seconds: 66840, estimated_cost: 53.6 },
      { id: "p2", name: "RTX 4090 × 2", status: "RUNNING", cost_per_hr: 0.74, uptime_seconds: 22200, estimated_cost: 4.57 },
      { id: "p3", name: "A40 × 1", status: "RUNNING", cost_per_hr: 0.56, uptime_seconds: 7500, estimated_cost: 1.17 },
    ],
    gpu_breakdown: [
      { name: "A100 80GB", amount: 6808, pct: 74 },
      { name: "RTX 4090", amount: 1656, pct: 18 },
      { name: "A40", amount: 736, pct: 8 },
    ],
    anomaly,
    _status: "mock",
  };
}


// ---------- Google Ads ----------
function getGoogleAdsMock() {
  const series = buildDailySeries(30, 145, 30, -1, 1, 4);
  const anomaly = zScoreOf(series);
  return {
    provider: "google_ads",
    today: series[series.length - 1].value,
    month_to_date: mtd(series),
    roas: 3.4,
    total_conversions_period: 312,
    daily_series: series,
    campaigns: [
      { name: "Brand", amount: 54.2, pct: 41, conversions: 80, roas: 5.1 },
      { name: "Search · Gen", amount: 38.1, pct: 29, conversions: 62, roas: 3.2 },
      { name: "Display", amount: 21.8, pct: 17, conversions: 24, roas: 2.1 },
      { name: "Retargeting", amount: 17.4, pct: 13, conversions: 31, roas: 4.4 },
    ],
    anomaly,
    _status: "mock",
  };
}

// ---------- Microsoft 365 ----------
function getMs365Mock() {
  return {
    provider: "ms365",
    total_licenses: 48,
    monthly_bill: 3600,
    cost_per_user: 75,
    premium_count: 32,
    basic_count: 16,
    new_ids_7d: 3,
    bill_change_vs_last_week: 66,
    mfa_pending: 1,
    recent_users: [
      { name: "Rahul Nair", email: "rahul@co.io", license: "Business Premium", created: "Jun 24", cost: 22 },
      { name: "Priya Menon", email: "priya@co.io", license: "Business Premium", created: "Jun 22", cost: 22 },
      { name: "Dev Sharma", email: "dev@co.io", license: "Business Basic", created: "Jun 19", cost: 6 },
      { name: "Arjun Pillai", email: "arjun@co.io", license: "Business Premium", created: "Jun 12", cost: 22 },
      { name: "Sneha Reddy", email: "sneha@co.io", license: "Business Basic", created: "May 30", cost: 6 },
    ],
    _status: "mock",
  };
}

const PROVIDER_MOCKS = {
  aws: getAwsMock,
  runpod: getRunpodMock,
  google_ads: getGoogleAdsMock,
  ms365: getMs365Mock,
};

const ANOMALY_HISTORY_MOCK = {
  aws: [
    { provider: "aws", date: "Jun 18", message: "EC2 +84% ($210 vs baseline $114). Auto-scaling triggered by traffic spike. Z-score: 2.41.", z_score: 2.41, emailed: true },
    { provider: "aws", date: "Jun 4", message: "New service: AWS Bedrock ($45.20, previously near-zero). Model inference costs starting.", z_score: 1.2, emailed: false },
  ],
  runpod: [
    { provider: "runpod", date: "Jun 26", message: "GPU spend spike: $640.80 vs baseline $224/day (+185%, z=3.8). Driven by A100 80GB pod running 18h+.", z_score: 3.8, emailed: true },
  ],
  google_ads: [],
  ms365: [
    { provider: "ms365", date: "Jun 24", message: "3 new Premium licences (+$66/mo). Bill jumped $3,534 → $3,600. No onboarding batch expected — verify with HR.", z_score: null, emailed: true },
    { provider: "ms365", date: "May 30", message: "1 new Basic licence added ($6/mo). Bill: $3,534/mo.", z_score: null, emailed: false },
  ],
};

function delay(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockApi = {
  async getOverview() {
    await delay();
    const providers = {
      aws: getAwsMock(),
      runpod: getRunpodMock(),
      google_ads: getGoogleAdsMock(),
      ms365: getMs365Mock(),
    };
    const todayTotal = providers.aws.today + providers.runpod.today + providers.google_ads.today;
    const mtdTotal = providers.aws.month_to_date + providers.runpod.month_to_date + providers.google_ads.month_to_date + providers.ms365.monthly_bill;
    const anomalies = Object.entries(providers)
      .filter(([, d]) => d.anomaly?.is_anomaly)
      .map(([key, d]) => ({ provider: key, ...d.anomaly }));

    return {
      providers,
      today_total: Math.round(todayTotal * 100) / 100,
      month_to_date_total: Math.round(mtdTotal * 100) / 100,
      projected_month_end: Math.round((mtdTotal + todayTotal * 4) * 100) / 100,
      active_anomalies: anomalies,
      generated_at: new Date().toISOString(),
    };
  },

  async getProvider(key) {
    await delay();
    const fn = PROVIDER_MOCKS[key];
    if (!fn) throw new Error(`Unknown provider '${key}'`);
    return fn();
  },

  async syncAll() {
    await delay(900);
    return { synced_at: new Date().toISOString() };
  },

  async syncProvider(key) {
    await delay(700);
    return PROVIDER_MOCKS[key] ? PROVIDER_MOCKS[key]() : {};
  },

  async getAnomalies(provider) {
    await delay(150);
    return ANOMALY_HISTORY_MOCK[provider] || [];
  },

  async getSettings() {
    await delay(100);
    return { z_score_threshold: 2.0, min_dollar_delta: 5, baseline_window_days: 14 };
  },

  async updateSettings() {
    await delay(300);
    return { status: "saved" };
  },
};

export default mockApi;
