# SpendWatch

Internal cloud billing dashboard for Xarka — tracks spend across **AWS,
RunPod, Google Ads, Microsoft 365, and Google Workspace** in one live view,
with anomaly detection, per-provider deep-dive pages, and a Microsoft-login
gate restricting access to Xarka's own tenant.

- **`frontend/`** — React + Vite, talking to the real backend (no mock data).
- **`backend/`** — FastAPI + Python. Real provider integrations (AWS Cost
  Explorer via boto3, RunPod REST API, Google Ads API, Microsoft Graph,
  Google Workspace Admin SDK), z-score anomaly detection, SQLite caching,
  parallelized provider fetching, and Microsoft OAuth login.

## Quick start

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
cp .env.example .env         # fill in real credentials, see below
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Required `.env` values

Each provider needs its own credentials — see `.env.example` for the full
annotated list. Summary:

| Provider | Vars | Notes |
|---|---|---|
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | IAM user needs Cost Explorer read access |
| RunPod | `RUNPOD_API_KEY` | From RunPod console -> Settings -> API Keys |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_CUSTOMER_ID` | OAuth2 app + Ads API developer token |
| Microsoft 365 | `MS365_TENANT_ID`, `MS365_CLIENT_ID`, `MS365_CLIENT_SECRET`, `MS365_BASIC_LICENSE_COST`, `MS365_STANDARD_LICENSE_COST`, `MS365_PREMIUM_LICENSE_COST` | App-only Graph API creds. License costs are in **INR** (India pricing), not USD |
| Google Workspace | `GWORKSPACE_ADMIN_EMAIL`, `GWORKSPACE_SERVICE_ACCOUNT_JSON_PATH`, `GWORKSPACE_SEATS`, `GWORKSPACE_COST_PER_SEAT`, `GWORKSPACE_DOMAIN` | Service account with domain-wide delegation |
| Login with Microsoft | `AUTH_REDIRECT_URI`, `AUTH_FRONTEND_URL`, `AUTH_SESSION_SECRET` | See **Authentication** below — reuses `MS365_*` client/tenant by default |
| Alerts | `SMTP_SENDER_EMAIL`, `SMTP_APP_PASSWORD`, `ALERT_RECIPIENTS` | Gmail app password for anomaly emails |
| App behavior | `CACHE_TTL_SECONDS`, `Z_SCORE_THRESHOLD`, `MIN_DOLLAR_DELTA`, `BASELINE_WINDOW_DAYS`, `CORS_ORIGIN` | Tuning knobs, sane defaults if omitted |

## Authentication (Login with Microsoft)

Access is restricted to accounts inside Xarka's own Microsoft 365 tenant.
This is a **separate OAuth flow** from the app-only Graph credentials used to
read organization billing data — it's the interactive flow a real person
goes through to sign in.

**One-time Azure AD setup** (on the same app registration as `MS365_CLIENT_ID`,
or a new one if you split them via `AUTH_CLIENT_ID`):

1. Azure Portal -> App registrations -> your app -> **Authentication** ->
   Add a platform -> **Web** -> redirect URI:
   `http://localhost:8000/api/auth/callback` (add your real domain later) ->
   check **ID tokens**.
2. **API permissions** -> add delegated **`User.Read`** -> **Grant admin
   consent** (needs a Global/Application Administrator on the tenant — ask
   IT/an org admin if you don't have this role yourself).
3. Generate a session-signing secret and put it in `.env`:
   ```bash
   openssl rand -hex 32
   ```
   ```dotenv
   AUTH_SESSION_SECRET=<paste the generated value here>
   ```

Until admin consent is granted, sign-in will fail with
`AADSTS500113: No reply address is registered` (missing redirect URI) or a
consent-required error (missing admin consent) — both expected until the
Azure-side setup above is complete.

**Temporarily disabling the login gate** (e.g. while waiting on the Azure
admin step): comment out the `isAuthenticated` check in `Gate()` inside
`frontend/src/App.jsx`, and no-op the `enforce_auth` middleware in
`backend/main.py`. Both are marked with `# TEMP` / `// TEMP` comments where
this applies — revert once permissions are granted.

## Project structure

```
frontend/
  src/
    api/
      client.js            — axios client, withCredentials for session cookie
    context/
      CurrencyContext.jsx  — global $/INR toggle (does NOT affect MS365 page —
                              that page's INR pricing is real, not converted)
      AuthContext.jsx       — signed-in user state, login()/logout()
    components/
      KpiCard, DailyBarChart, BreakdownPanel, AnomalyHistory,
      Sidebar, Topbar, ProfileMenu, ExportButton, etc.
    hooks/
      useProviderData.js   — per-provider + overview data fetching/sync hooks
    pages/
      Overview.jsx, AwsPage.jsx, RunPodPage.jsx, GoogleAdsPage.jsx,
      Microsoft365Page.jsx, GoogleWorkspacePage.jsx, SettingsPage.jsx,
      LoginPage.jsx
    App.jsx                — router, auth gate, shell layout

backend/
  main.py                  — FastAPI app, REST endpoints, parallel provider
                              fetch (ThreadPoolExecutor), auth middleware
  auth.py                  — Microsoft OAuth login flow, tenant check,
                              session cookie issuance/validation
  config.py                — loads all credentials from .env
  anomaly.py                — shared z-score anomaly detection
  cache.py                  — SQLite caching + anomaly history + settings
  alerts.py                  — Gmail SMTP anomaly alert emails
  providers/
    aws.py                    — Cost Explorer: service/usage-type/linked-
                                 account breakdown, forecast, RI/Savings
                                 Plan utilization
    aws_resources.py            — live EC2 inventory
    runpod.py                    — pods, billing, savings/uptime/spot split
    google_ads.py                  — campaigns, CPC/CPM trend, network
                                     split, wasted-spend detection
    microsoft365.py                  — licenses, inactive-seat detection,
                                       license trend, MFA status
    google_workspace.py                — storage, inactive seats, Gmail
                                         volume, cost-per-active-user
  .env.example
  requirements.txt
```

## Notable behavior

- **Parallel provider fetching** — `/api/overview` and `/api/sync` fetch all
  5 providers concurrently via a thread pool, not sequentially, so total
  wait time is roughly the slowest single provider instead of the sum of
  all five.
- **Currency handling** — the topbar $/INR toggle converts AWS, RunPod, Google
  Ads, and Google Workspace figures at live exchange rate. **Microsoft 365
  is the exception**: its numbers are true Indian list pricing already in
  INR, so that page ignores the toggle entirely rather than double-converting.
- **RunPod billing gaps** — RunPod bills continuously per-second while a pod
  runs, not on a monthly/weekly cycle. An empty result for a date range
  means no pods were active in that window, not a billing delay — the page
  surfaces the specific reason (no activity / pending / storage-only /
  API error) instead of a bare empty chart.
- **Graceful permission fallbacks** — if a Graph permission like
  `AuditLog.Read.All` (needed for inactive-seat detection) isn't granted,
  the affected feature shows an explanatory note instead of failing the
  whole page.