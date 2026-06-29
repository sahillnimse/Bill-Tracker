# SpendWatch — React + Python port

A faithful port of the `spendwatch_v3.html` mockup into a real, two-tier app:

- **`frontend/`** — React + Vite. Fully working right now against **mock data**
  (`src/api/mockClient.js`) so you can click through every page, trigger
  anomaly states, and see the exact same visual design as the original HTML.
- **`backend/`** — FastAPI + Python, scaffolded but **not wired up yet** per
  your request. It already has real provider integrations written (AWS Cost
  Explorer, RunPod GraphQL, GA4 Data API, Google Ads API, Microsoft Graph),
  z-score anomaly detection, SQLite caching, and Gmail SMTP alerts — same
  patterns as your existing cloud cost tracker. It's just not connected to
  the frontend yet.

## Running the frontend now

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — this works standalone, no backend needed,
because `USE_MOCK = true` in `src/api/client.js`.

## Switching to the real backend later

1. `cd backend && pip install -r requirements.txt --break-system-packages`
2. `cp .env.example .env` and fill in real credentials per provider (each
   section of `.env.example` has step-by-step setup notes).
3. `uvicorn main:app --reload --port 8000`
4. In `frontend/src/api/client.js`, flip `const USE_MOCK = true` to `false`.

That's the only change needed on the frontend — every page component reads
from `api.getOverview()` / `api.getProvider(key)` etc., and the real client
returns the exact same JSON shape as the mock client.

## Project structure

```
frontend/
  src/
    api/
      client.js        — switches between mock and real backend
      mockClient.js     — deterministic mock data, same shape as backend
    components/         — KpiCard, DailyBarChart, Sparkline, BreakdownPanel,
                           AnomalyHistory, Sidebar, Topbar
    hooks/
      useProviderData.js — data fetching + sync hooks
    pages/
      Overview.jsx, AwsPage.jsx, RunPodPage.jsx, GoogleAnalyticsPage.jsx,
      GoogleAdsPage.jsx, Microsoft365Page.jsx, SettingsPage.jsx
    App.jsx              — router + shell layout
    App.css               — all component styles (ported 1:1 from the
                             original mockup's CSS)
    index.css             — design tokens / CSS variables + global resets

backend/
  main.py                — FastAPI app, REST endpoints
  config.py               — loads all credentials from .env
  anomaly.py               — shared z-score anomaly detection
  cache.py                 — SQLite caching + anomaly history + settings
  alerts.py                 — Gmail SMTP anomaly alert emails
  providers/
    aws.py                  — AWS Cost Explorer (boto3)
    runpod.py                — RunPod GraphQL API
    google_analytics.py       — GA4 Data API (service account)
    google_ads.py              — Google Ads API (OAuth2)
    microsoft365.py             — Microsoft Graph (client credentials)
  .env.example                  — every credential needed, documented
  requirements.txt
```

## What's preserved from the original mockup

- Exact color palette, fonts (Inter + JetBrains Mono), spacing, and all
  CSS animations (pulse banners, sparklines, fill-in bars, pip indicators).
- Sidebar nav with provider badges, topbar with sync button, KPI cards,
  deep-analysis cards, two-column chart/breakdown panels, anomaly history
  rows, pod cards, employee table, settings panel.
- Anomaly z-score logic — the mock client computes z-scores client-side
  using the same formula `anomaly.py` uses server-side, so flipping to the
  real backend won't change how anomalies are flagged.

## What's different (now using React Router instead of single-file JS)

- Each provider is a real route (`/aws`, `/runpod`, `/ga4`, `/google-ads`,
  `/ms365`, `/settings`) instead of a `nav()` function toggling `display`.
  Browser back/forward and direct links now work correctly.
- The sub-tabs from the original (`Overview / Anomalies / Cost by tag /
  Forecasts` etc.) were cosmetic-only placeholders in the original HTML —
  they didn't change any content. They've been dropped for now since they
  had no behavior to port; happy to wire them to real sub-views if useful.
