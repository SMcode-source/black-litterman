# The app

A React + Vite single-page app that runs the whole Black-Litterman pipeline in the browser —
no server call anywhere in the critical path.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run lint
```

The equity tab needs a data snapshot at `public/data/`. Build one from the repo root:

```bash
python data-pipeline/fetch_equity_data.py --out app/public/data --limit 50
```

(`--limit` keeps local iteration quick; drop it for the full index.) Without a snapshot the
equity tab shows an error banner and the credit tab still works — its universe is bundled.

## Source layout

| File | Role |
|---|---|
| `src/blcore.js` | The engine. No dependencies, no framework — plain typed-array numerics. |
| `src/datasets.js` | Loads equities and credit, normalising both to one dataset shape. |
| `src/App.jsx` | The UI: asset-class switch, universe picker, priors & views, results. |
| `src/constants.js` | The bundled credit universe and its sector/rating correlation structure. |

### `blcore.js`

```
equilibriumReturns(cov, wBmk, delta, n)     pi = delta * Sigma * w_bmk
buildViews(views, indexOf, cov, tau, n)     -> P rows, Q, Omega (He-Litterman)
posterior(cov, pi, viewRows, tau, n)        -> { muBL, sigmaOp }
optimise({ mu, sigmaOp, delta, n, lo, hi }) -> { w, iters, status }
portfolioStats({ w, wBmk, mu, cov, ... })   return, vol, Sharpe, tracking error
groupWeights(items, w, wBmk, key)           aggregate by sector / rating
```

Two decisions make the full S&P 500 tractable in a tab:

**The posterior is computed in view space.** `μ_BL = π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − Pπ)` inverts a
K×K matrix, where K is the number of views. The N×N covariance is never inverted.

**`sigmaOp` is an operator, not a matrix.** `Σ_post` equals `(1+τ)Σ` minus a rank-K correction,
so `posterior` returns an object exposing only `mul(v)`. Materialising it would cost 235k
float64 writes per solve for no benefit — the optimiser only ever needs `Σ_post v`.

`optimise` is a spectral projected gradient: Barzilai-Borwein step sizes with a `1/L` fallback
(L from power iteration on `sigmaOp`), and a Euclidean projection onto
`{w : Σw = 1, lo ≤ w ≤ hi}` by bisection on the shift θ. Every buffer is preallocated and the
loop swaps references rather than allocating, so the steady state does no GC work.

### `datasets.js`

Both asset classes reduce to `{ key, label, n, items[], cov, wBmk, meta }`, which is why the
engine and most of the UI are asset-class agnostic. Equity covariance arrives precomputed as a
binary `.f32`; credit covariance is built in `creditCovariance()` from OAS volatility, spread
duration, and a sector/rating correlation matrix.

The covariance stays a `Float32Array` all the way through. The matvec reads N² elements and
does N² multiply-adds — it is memory-bandwidth bound, so halving the bytes roughly doubles
throughput. Precision is not the constraint here; the input covariance is an estimate with far
more than 1e-7 relative error.

`subsetDataset` preserves the source array type (`new (ds.cov.constructor)(m * m)`) so
narrowing the universe does not silently promote the matrix back to float64.

## Units

Equity works in decimal returns and shows percent; credit works in decimal spreads and shows
basis points. `App.jsx` holds a single `UNITS` table (`{ scale, suffix }`) and every input and
display goes through it, so nothing else in the UI needs to know which asset class is active.

## Priors

Three things are editable, and all three feed the same solve:

- **Parameters** — δ, τ, risk-free rate, min/max weight
- **Views** — absolute or relative, each with a confidence that sets `Ω_kk = τ(p'Σp)(1/c − 1)`
- **The equilibrium prior itself** — π is listed per asset and can be overridden; overrides are
  merged into `effectivePrior` before the posterior is formed, so you can replace the market's
  implied view entirely rather than only tilting away from it

## `backend/` — optional, not deployed

A FastAPI service (`/api/v1/optimise`, `/api/v1/equilibrium`, `/api/v1/upload-bonds`) that
solves the credit problem with cvxpy and adds Monte Carlo Credit VaR/CVaR, plus spreadsheet
upload for a custom bond universe. It predates the in-browser engine and the app no longer
calls it -- GitHub Pages is static, and `blcore.js` covers the hosted feature set. It is kept
because cvxpy handles constraint shapes the projected-gradient solver does not (turnover
limits, cardinality, arbitrary linear constraints) and is the natural place to grow into.

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
