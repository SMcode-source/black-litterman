# Black-Litterman

Two Black-Litterman portfolio optimisation projects in one repository: an equity model
over the S&P 500, and an interactive credit optimiser for investment-grade corporate bonds.

**Live site:** https://smcode-source.github.io/black-litterman/
**Credit optimiser (runs in your browser):** https://smcode-source.github.io/black-litterman/credit/

Both apply the same Bayesian core — blend market-implied equilibrium returns (reverse
optimisation) with investor views to produce a posterior return vector, then optimise
against it — but they target different asset classes and ship as different kinds of software.

| | [`equity/`](equity/) | [`credit/`](credit/) |
|---|---|---|
| **Asset class** | S&P 500 equities (~500 names) | Investment-grade corporate bonds |
| **Form** | Python CLI / batch analysis | Web app (React SPA + FastAPI API) |
| **Data source** | Yahoo Finance (`yfinance`) | Bundled sample universe, or user file upload |
| **Optimiser** | `scipy` constrained optimisation | `cvxpy` (Python) with a JS browser fallback |
| **Outputs** | CSV exports + matplotlib charts | Interactive Recharts dashboards |

## `equity/` — S&P 500 Black-Litterman model

Batch Python pipeline: fetches prices and market caps, derives market-implied returns from
market-cap equilibrium weights, blends in views, and optimises with position constraints.
Results are written to `equity/results/` as CSVs plus a summary plot.

```bash
cd equity
pip install -r requirements.txt
python main.py
```

Parameters — risk-free rate, risk premium, date range, `tau`, view confidence, min/max
position weights — live in [`equity/config.py`](equity/config.py). Fetched data is cached in
`equity/cache/` so reruns don't re-hit the API. See [`equity/README.md`](equity/README.md) for full detail.

## `credit/` — Credit Black-Litterman optimiser

Single-page React app over a FastAPI backend, adding credit-specific analytics on top of
the BL framework: expected loss, spread duration, DTS, and Monte Carlo Credit VaR/CVaR.
Supports absolute and relative views, issuer and sector limits, and tracking-error control.
The frontend carries its own JavaScript engine, so it stays usable when the backend is unreachable.

```bash
# Frontend
cd credit
npm install
npm run dev

# Backend (separate shell)
cd credit/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Set `VITE_API_URL=http://localhost:8000` in `credit/.env` to point the frontend at your local
backend. See [`credit/README.md`](credit/README.md) for the deployed URLs, environment
variables, and module-by-module breakdown.

## Repository notes

- Each project keeps its own `requirements.txt` and README; there is no shared build step
  and no cross-imports between the two.
- Generated artefacts — `equity/cache/`, `equity/raw_data/`, `equity/results/`, `node_modules/`,
  virtualenvs — are gitignored and recreated by running the projects.
- The site is built and deployed by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
  on every push to `main`: it builds the credit app and serves it at `/credit/` under the
  landing page in [`site/index.html`](site/index.html). The app is built without `VITE_API_URL`,
  so the published version runs its browser engine and needs no backend.
- `equity/market_implied_returns/` holds a small set of standalone output CSVs carried over
  from the original project. Nothing in this repo regenerates them, so they are tracked in git
  rather than gitignored like the other outputs.
