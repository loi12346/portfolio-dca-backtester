# Portfolio DCA Backtesting MVP

Lightweight upload -> simulate -> visualize web app for ETF and stock DCA backtests.

## Stack

- Frontend: Next.js, React, TailwindCSS, Recharts
- Backend: FastAPI
- Quant engine: pandas, numpy

## Run Locally

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

## MVP Scope

Implemented:

- CSV/XLSX upload through FastAPI multipart form data
- Portfolio allocation validation at 100%
- Monthly DCA with annual contribution increase
- Next trading day execution for non-trading DCA dates
- Optional dividend reinvestment
- Final value, invested capital, profit, total return, CAGR, max drawdown, Sharpe, Sortino
- Portfolio growth, drawdown, and contribution vs growth charts

Not included:

- Authentication
- Database
- Broker APIs
- Live market data
- Real-time trading
