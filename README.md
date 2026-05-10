# Portfolio DCA Backtesting MVP

Lightweight upload -> simulate -> visualize web app for ETF and stock DCA backtests.

## Stack

- Frontend: Next.js, React, TailwindCSS, Recharts
- Backend: FastAPI
- Quant engine: pandas, numpy

## Run Locally

Install dependencies from the project root:

```powershell
npm.cmd run setup
```

From the project root:

```powershell
npm.cmd run dev
```

This starts the backend on `http://127.0.0.1:8000` and the frontend on `http://localhost:3000`.

You can also run each service manually.

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Free Deployment

Recommended MVP setup:

- GitHub for source control
- Render Free for the FastAPI backend
- Vercel Free for the Next.js frontend

Free backend services may sleep when idle, so the first simulation after inactivity can take a little longer.

### 1. Push To GitHub

Push this repo to GitHub from the current branch or merge it into your main branch first.

### 2. Deploy Backend On Render

Create a new Render Web Service from the GitHub repo.

Use the included `render.yaml`, or configure manually:

```text
Root directory: backend
Build command: pip install -r requirements.txt
Start command: uvicorn main:app --host 0.0.0.0 --port $PORT
Health check path: /health
```

After deploying the frontend, set this Render environment variable:

```text
CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

For Vercel preview URLs during testing, you can temporarily use:

```text
CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app
```

### 3. Deploy Frontend On Vercel

Import the same GitHub repo in Vercel.

Use:

```text
Root directory: frontend
Framework preset: Next.js
Build command: npm run build
Output directory: .next
```

Set this Vercel environment variable:

```text
NEXT_PUBLIC_API_URL=https://your-render-backend.onrender.com
```

Redeploy the frontend after setting the environment variable.

## Upload Format

Each CSV or XLSX file should be named after the asset symbol, for example `VOO.csv`.

Required columns:

```csv
Date,Close
```

Optional dividend column:

```csv
Date,Close,Dividends
```

Sample files are included under `sample-data`.

## Multi-Scenario Comparison

The app supports comparing multiple portfolio allocations under one shared DCA strategy.

Example scenarios:

- `VOO 100`
- `QQQ 100`
- `VOO 60 / QQQ 40`
- `VOO 40 / QQQ 60`

Upload one file per asset, then edit the inferred asset label if needed. Scenario allocations select from those uploaded labels.

## MVP Scope

Implemented:

- CSV/XLSX upload through FastAPI multipart form data
- Editable uploaded asset labels
- Multi-scenario portfolio allocation validation at 100%
- Monthly DCA with annual contribution increase
- Next trading day execution for non-trading DCA dates
- Optional dividend reinvestment
- Final value, invested capital, profit, total return, CAGR, max drawdown, Sharpe, Sortino
- Scenario comparison growth and drawdown charts
- Per-scenario contribution vs growth chart

Not included:

- Authentication
- Database
- Broker APIs
- Live market data
- Real-time trading
