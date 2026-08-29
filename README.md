# Black-Litterman

An interactive Black-Litterman optimiser for **S&P 500 equities** and **investment-grade
credit**, in one app. It derives the returns the market already implies, blends in your own
priors and views, and solves the constrained portfolio problem — entirely in the browser.

**Live:** https://smcode-source.github.io/black-litterman/
**App:** https://smcode-source.github.io/black-litterman/app/

## What it does

| | Equities | Credit |
|---|---|---|
| Universe | S&P 500, ~485 of 503 usable | Sample IG corporate bonds, 25 issuers |
| Data | Yahoo Finance, refreshed every weekday | Bundled sample universe |
| Covariance | Daily log returns, annualised | OAS × spread duration, sector/rating correlation |
| Extra analytics | — | Expected loss, spread duration, DTS, Credit VaR |

Both asset classes run through the same engine (`app/src/blcore.js`). You control:

- **Parameters** — risk aversion δ, prior uncertainty τ, risk-free rate, min/max position weight
- **The prior itself** — the implied equilibrium return π is shown per asset and can be hand-edited
- **Views** — absolute ("NVDA returns 40%") or relative ("AAPL beats MSFT by 10%"), each with
  its own confidence, which sets the corresponding diagonal entry of Ω

## Why it can optimise the whole index in a browser

A textbook implementation inverts the N×N covariance. At N ≈ 485 that is ~10⁸ operations and
will lock the tab. Four choices avoid it:

1. **The posterior is formed in view space.**

   `μ_BL = π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − Pπ)`

   The only matrix inverted is **K×K**, where K is the number of views — usually two or three.
   The covariance is never inverted at all.

2. **The posterior covariance is never materialised.** `Σ_post` is `Σ` plus a rank-K correction,
   so it is exposed as an operator with a `mul(v)` method costing O(N² + KN). The optimiser —
   a spectral projected gradient with Barzilai-Borwein steps — needs nothing else.

3. **The covariance stays `float32`.** The matvec is memory-bandwidth bound rather than compute
   bound, so halving the bytes (1.88 MB → 940 KB) roughly doubled throughput. This was the
   single largest speedup, and it is not an algorithmic one.

4. **The solver stops when it is converged**, testing the stationarity residual under a fixed
   `1/L` step — zero exactly at a KKT point. The obvious alternative, asking whether the last
   step moved anything, is meaningless for Barzilai-Borwein: its step size swings over orders
   of magnitude by design, so a small step means either "converged" or "α is small right now".

A solve with views converges in **~600 iterations**; with no views it takes ~1450, since what
remains is the poorly conditioned minimum-variance direction. The full pipeline over 485 names
measures **163 ms** on a CI runner. Budget more like a second in a browser — no worker thread,
no server, nothing leaves the tab.

## Repository layout

```
app/                  Unified React app (Vite) -- the deployed site
  src/blcore.js         BL engine: equilibrium, views, posterior, optimiser, risk
  src/datasets.js       Equity + credit adapters, normalised to one shape
  src/App.jsx           UI: universe, priors & views, results
  backend/              Optional FastAPI service (cvxpy + Monte Carlo VaR), not hosted
data-pipeline/
  fetch_equity_data.py  Yahoo Finance -> static snapshot
  check_engine.mjs      Engine correctness checks, run on every deploy
equity/               Original standalone Python batch model
site/index.html       Landing page
```

## The data pipeline

Yahoo Finance sends no CORS headers, so a static page cannot fetch it directly — every
endpoint fails with `TypeError: Failed to fetch`. Instead the deploy workflow fetches on the
server and ships the result as a static asset:

- `equity_universe.json` — tickers, names, sectors, market caps, mean returns, vols (~90 KB)
- `equity_cov.f32` — N×N annualised covariance, row-major float32 (~940 KB)

It runs on every push and on a weekday cron at 23:00 UTC, comfortably after the US close.
If the fetch fails the job fails by design, leaving the last good deploy serving real data
rather than publishing an app with no universe.

The snapshot is gitignored — it is a build artefact, and committing a 1 MB binary daily would
bloat history.

## Running locally

```bash
# 1. Build the data snapshot (needs network)
python -m venv .venv-data
./.venv-data/Scripts/pip install -r data-pipeline/requirements.txt   # Windows
python data-pipeline/fetch_equity_data.py --out app/public/data

# 2. Run the app
cd app
npm install
npm run dev
```

Use `--limit 25` on the fetch script for a fast snapshot while developing. Without a snapshot
the app shows an error banner on the equity tab; the credit side needs no external data and
still works.

To verify the engine against whatever snapshot you have:

```bash
node data-pipeline/check_engine.mjs
```

It asserts that the covariance is symmetric and PSD; that reverse optimisation round-trips,
since with τ→0 and no views the optimiser must return the benchmark exactly; that the answer at
the default tolerance is unchanged by running 10x longer; that views move the posterior in the
right direction and monotonically in confidence; that a relative view widens the right spread
without overshooting it; that position caps bind under an extreme view; and that a full-universe
solve still finishes in seconds.

The same run gates every deploy, against the snapshot fetched minutes earlier -- so a Yahoo
change that quietly corrupts the covariance fails the build rather than reaching the site.

### The optional backend

`app/backend/` is a FastAPI service adding a cvxpy solver and Monte Carlo Credit VaR/CVaR.
It is not part of the hosted site -- GitHub Pages is static, and the browser engine covers the
hosted feature set -- but it handles constraint shapes the projected-gradient solver does not
(turnover limits, cardinality, arbitrary linear constraints).

```bash
cd app/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### The original Python model

`equity/` holds the standalone batch implementation the equity side grew out of. It runs the
same method offline and writes CSVs plus a matplotlib chart.

```bash
cd equity
pip install -r requirements.txt
python main.py
```
