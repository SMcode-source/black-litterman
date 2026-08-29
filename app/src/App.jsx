/**
 * Black-Litterman Optimiser -- unified equity + credit workbench.
 *
 * One app, two asset classes, one engine:
 *   - Equities: S&P 500 from a Yahoo Finance snapshot rebuilt daily
 *   - Credit:   sample investment-grade corporate bond universe
 *
 * You supply the priors -- risk aversion, prior uncertainty, an optional
 * hand-edited equilibrium return vector, and any number of absolute or
 * relative views with individual confidence levels.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, Legend, ScatterChart, Scatter, ReferenceLine,
} from "recharts";
import {
  Settings, Eye, BarChart3, Play, Plus, Trash2, Loader2, RotateCcw,
  TrendingUp, Landmark, Search, Check, AlertTriangle, Database,
} from "lucide-react";

import {
  equilibriumReturns, buildViews, posterior, optimise,
  portfolioStats, groupWeights,
} from "./blcore.js";
import {
  loadEquityDataset, loadCreditDataset, subsetDataset, creditRiskExtras,
} from "./datasets.js";
import { SECTOR_COLORS } from "./constants.js";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// Equity returns are annualised decimals; credit works in spread basis points.
const UNITS = {
  equity: { scale: 100, suffix: "%", dp: 2, label: "annualised" },
  credit: { scale: 10000, suffix: "bp", dp: 1, label: "spread, annualised" },
};

const fmt = (v, u, dp) =>
  v == null || !isFinite(v) ? "--" : (v * u.scale).toFixed(dp ?? u.dp);

const pct = (v, dp = 2) => (v == null || !isFinite(v) ? "--" : (v * 100).toFixed(dp) + "%");

const bigMoney = (v) =>
  !v ? "--"
  : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;

const PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899",
                 "#ef4444", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
                 "#06b6d4", "#a855f7"];
const sectorColor = (name) => {
  if (SECTOR_COLORS[name]) return SECTOR_COLORS[name];
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
};

const DEFAULT_PARAMS = {
  equity: { delta: 2.5, tau: 0.05, riskFree: 0.04, minW: 0, maxW: 0.10 },
  credit: { delta: 2.0, tau: 0.05, riskFree: 0, minW: 0, maxW: 0.15 },
};

const ROW_CAP = 150;

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Tile({ label, value, unit, sub, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 border-slate-200", blue: "bg-blue-50 border-blue-200",
    amber: "bg-amber-50 border-amber-200", green: "bg-emerald-50 border-emerald-200",
    violet: "bg-violet-50 border-violet-200", rose: "bg-rose-50 border-rose-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
        {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700">{label}</span>
      {hint && <span className="block text-[11px] text-slate-400 mb-1">{hint}</span>}
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums " +
  "focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function App() {
  const [assetClass, setAssetClass] = useState("equity");
  const [tab, setTab] = useState("universe");

  const [equity, setEquity] = useState(null);
  const [equityError, setEquityError] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const credit = useMemo(() => loadCreditDataset(), []);

  // Per-asset-class state, kept separate so switching does not clobber work.
  const [selection, setSelection] = useState({ equity: null, credit: null });
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [views, setViews] = useState({ equity: [], credit: [] });
  const [priorOverrides, setPriorOverrides] = useState({ equity: {}, credit: {} });
  const [results, setResults] = useState({ equity: null, credit: null });

  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("All");
  const runToken = useRef(0);

  // ---- load the Yahoo snapshot once -------------------------------------
  useEffect(() => {
    let alive = true;
    loadEquityDataset()
      .then((ds) => {
        if (!alive) return;
        setEquity(ds);
        setSelection((s) => ({ ...s, equity: ds.items.map((_, i) => i) }));
      })
      .catch((e) => { if (alive) setEquityError(e.message); })
      .finally(() => { if (alive) setLoadingData(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setSelection((s) => (s.credit ? s : { ...s, credit: credit.items.map((_, i) => i) }));
  }, [credit]);

  const full = assetClass === "equity" ? equity : credit;
  const unit = UNITS[assetClass];
  const P = params[assetClass];
  const myViews = views[assetClass];
  const myOverrides = priorOverrides[assetClass];
  const myResults = results[assetClass];
  const selected = selection[assetClass];

  // Selected slice of the universe -- everything downstream runs on this.
  const ds = useMemo(() => {
    if (!full || !selected || selected.length < 2) return null;
    return subsetDataset(full, selected);
  }, [full, selected]);

  // Equilibrium prior, recomputed whenever the selection or delta changes.
  const equilibrium = useMemo(
    () => (ds ? equilibriumReturns(ds.cov, ds.wBmk, P.delta, ds.n) : null),
    [ds, P.delta]
  );

  // Prior actually fed to the blend, after any hand edits.
  const effectivePrior = useMemo(() => {
    if (!equilibrium || !ds) return null;
    const out = Float64Array.from(equilibrium);
    ds.items.forEach((it, i) => {
      const o = myOverrides[it.id];
      if (o != null && isFinite(o)) out[i] = o / unit.scale;
    });
    return out;
  }, [equilibrium, ds, myOverrides, unit.scale]);

  const overrideCount = Object.keys(myOverrides).length;

  // ---- state setters ----------------------------------------------------
  const setParam = (k, v) =>
    setParams((p) => ({ ...p, [assetClass]: { ...p[assetClass], [k]: v } }));
  const setMyViews = (fn) =>
    setViews((v) => ({ ...v, [assetClass]: typeof fn === "function" ? fn(v[assetClass]) : fn }));
  const setOverride = (id, val) =>
    setPriorOverrides((o) => {
      const next = { ...o[assetClass] };
      if (val === "" || val == null) delete next[id];
      else next[id] = parseFloat(val);
      return { ...o, [assetClass]: next };
    });

  const toggle = (i) =>
    setSelection((s) => {
      const cur = new Set(s[assetClass]);
      if (cur.has(i)) cur.delete(i); else cur.add(i);
      return { ...s, [assetClass]: [...cur].sort((a, b) => a - b) };
    });

  const selectTopN = (n) => {
    if (!full) return;
    const order = full.items
      .map((it, i) => [i, it.marketCap ?? it.mktValue ?? 0])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([i]) => i)
      .sort((a, b) => a - b);
    setSelection((s) => ({ ...s, [assetClass]: order }));
  };

  // ---- the pipeline -----------------------------------------------------
  const run = useCallback(() => {
    if (!ds || !effectivePrior) return;
    setRunning(true);
    const token = ++runToken.current;

    // Yield a frame so the spinner paints before the (synchronous) solve.
    setTimeout(() => {
      const t0 = performance.now();
      const idIndex = new Map(ds.items.map((it, i) => [it.id, i]));
      const indexOf = (id) => (idIndex.has(id) ? idIndex.get(id) : -1);

      const viewRows = buildViews(myViews, indexOf, ds.cov, P.tau, ds.n);
      const { muBL, sigmaOp, viewImpact, singular } =
        posterior(ds.cov, effectivePrior, viewRows, P.tau, ds.n);

      const { w, iters } = optimise({
        mu: muBL, sigmaOp, delta: P.delta, n: ds.n,
        lo: P.minW, hi: P.maxW, w0: ds.wBmk,
      });

      const stats = portfolioStats({
        w, wBmk: ds.wBmk, mu: muBL, cov: ds.cov, sigmaOp, n: ds.n, riskFree: P.riskFree,
      });
      const priorStats = portfolioStats({
        w: ds.wBmk, wBmk: ds.wBmk, mu: effectivePrior, cov: ds.cov,
        sigmaOp: null, n: ds.n, riskFree: P.riskFree,
      });

      const extras = ds.key === "credit" ? creditRiskExtras(ds.items, w, ds.wBmk) : null;

      const rows = ds.items.map((it, i) => ({
        ...it,
        prior: effectivePrior[i],
        posterior: muBL[i],
        weight: w[i],
        bmk: ds.wBmk[i],
        active: w[i] - ds.wBmk[i],
      }));

      if (token !== runToken.current) return;
      setResults((r) => ({
        ...r,
        [assetClass]: {
          rows, stats, priorStats, extras, iters, viewImpact, singular,
          n: ds.n,
          sectors: groupWeights(ds.items, w, ds.wBmk, "sector"),
          ratings: ds.key === "credit" ? groupWeights(ds.items, w, ds.wBmk, "ratingBucket") : null,
          ms: Math.round(performance.now() - t0),
          viewCount: viewRows.length,
        },
      }));
      setRunning(false);
      setTab("results");
    }, 20);
  }, [ds, effectivePrior, myViews, P, assetClass]);

  // ---- universe filtering ----------------------------------------------
  const sectors = useMemo(
    () => (full ? ["All", ...[...new Set(full.items.map((i) => i.sector))].sort()] : ["All"]),
    [full]
  );

  const filtered = useMemo(() => {
    if (!full) return [];
    const q = search.trim().toUpperCase();
    const out = [];
    for (let i = 0; i < full.items.length; i++) {
      const it = full.items[i];
      if (sectorFilter !== "All" && it.sector !== sectorFilter) continue;
      if (q && !it.id.includes(q) && !it.name.toUpperCase().includes(q)) continue;
      out.push([i, it]);
    }
    return out;
  }, [full, search, sectorFilter]);

  const shown = filtered.slice(0, ROW_CAP);
  const selectedSet = useMemo(() => new Set(selected || []), [selected]);

  // -------------------------------------------------------------------------
  if (loadingData && assetClass === "equity" && !equity && !equityError) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="animate-spin" size={20} />
          <span className="text-sm">Loading S&amp;P 500 snapshot...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-lg font-bold leading-tight">Black-Litterman Optimiser</h1>
            <p className="text-xs text-slate-500">Equity &amp; credit portfolio construction</p>
          </div>

          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {[["equity", "Equities", TrendingUp], ["credit", "Credit", Landmark]].map(
              ([k, label, Icon]) => (
                <button
                  key={k}
                  onClick={() => { setAssetClass(k); setSearch(""); setSectorFilter("All"); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${
                    assetClass === k ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              )
            )}
          </div>

          <button
            onClick={run}
            disabled={running || !ds}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold
                       text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {running ? "Solving..." : "Run Optimisation"}
          </button>
        </div>

        <div className="max-w-7xl mx-auto px-5 pb-2 flex flex-wrap items-center gap-2 text-xs">
          {[["universe", "Universe", Settings],
            ["priors", "Priors & Views", Eye],
            ["results", "Results", BarChart3]].map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${
                tab === k ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
          {full && (
            <span className="ml-auto flex items-center gap-1.5 text-slate-500">
              <Database size={12} />
              {full.meta?.asOf && full.key === "equity"
                ? `Yahoo Finance · as of ${full.meta.asOf} · ${full.meta.observations} daily obs`
                : full.meta?.source}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-5">
        {equityError && assetClass === "equity" && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <AlertTriangle size={16} className="mt-0.5 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold text-amber-900">Could not load the equity snapshot</p>
              <p className="text-amber-800">{equityError}</p>
              <p className="mt-1 text-xs text-amber-700">
                The snapshot is generated at deploy time by <code>data-pipeline/fetch_equity_data.py</code>.
                Credit needs no external data and still works.
              </p>
            </div>
          </div>
        )}

        {/* ================= UNIVERSE ================= */}
        {tab === "universe" && full && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="mr-auto">
                <h2 className="font-semibold">{full.label}</h2>
                <p className="text-xs text-slate-500">
                  {selected?.length ?? 0} of {full.n} selected
                  {ds && ds.n !== full.n && " · optimising the selected subset"}
                </p>
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ticker or name"
                  className={inputCls + " w-56 pl-8"}
                />
              </div>

              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className={inputCls + " w-44"}
              >
                {sectors.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {[25, 50, 100].filter((n) => n < full.n).map((n) => (
                <button key={n} onClick={() => selectTopN(n)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
                  Top {n} by size
                </button>
              ))}
              <button
                onClick={() => setSelection((s) => ({ ...s, [assetClass]: full.items.map((_, i) => i) }))}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
                Select all {full.n}
              </button>
              <button
                onClick={() => setSelection((s) => ({ ...s, [assetClass]: [] }))}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
                Clear
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 p-2"></th>
                    <th className="p-2 text-left">Ticker</th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Sector</th>
                    {assetClass === "credit" && <th className="p-2 text-left">Rating</th>}
                    {assetClass === "credit" && <th className="p-2 text-right">OAS</th>}
                    {assetClass === "credit" && <th className="p-2 text-right">Spd Dur</th>}
                    {assetClass === "equity" && <th className="p-2 text-right">Market cap</th>}
                    {assetClass === "equity" && <th className="p-2 text-right">Vol</th>}
                    <th className="p-2 text-right">Bmk wt</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(([i, it]) => {
                    const on = selectedSet.has(i);
                    const c = sectorColor(it.sector);
                    return (
                      <tr key={it.id} onClick={() => toggle(i)}
                          className={`cursor-pointer border-t border-slate-100 ${
                            on ? "bg-blue-50/40" : "hover:bg-slate-50"}`}>
                        <td className="p-2">
                          <span className={`grid h-4 w-4 place-items-center rounded border ${
                            on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                            {on && <Check size={11} strokeWidth={3} />}
                          </span>
                        </td>
                        <td className="p-2 font-semibold">{it.id}</td>
                        <td className="max-w-[220px] truncate p-2 text-slate-600">{it.name}</td>
                        <td className="p-2">
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                                style={{ background: c + "22", color: c }}>
                            {it.sector}
                          </span>
                        </td>
                        {assetClass === "credit" && <td className="p-2">{it.rating}</td>}
                        {assetClass === "credit" && <td className="p-2 text-right tabular-nums">{it.oas}</td>}
                        {assetClass === "credit" && <td className="p-2 text-right tabular-nums">{it.spreadDur}</td>}
                        {assetClass === "equity" && <td className="p-2 text-right tabular-nums">{bigMoney(it.marketCap)}</td>}
                        {assetClass === "equity" && <td className="p-2 text-right tabular-nums">{pct(it.vol, 1)}</td>}
                        <td className="p-2 text-right tabular-nums">{pct(full.wBmk[i], 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > ROW_CAP && (
              <p className="mt-2 text-xs text-slate-500">
                Showing {ROW_CAP} of {filtered.length} matches -- narrow the search to see the rest.
                The optimisation still uses every selected name, not just the visible ones.
              </p>
            )}
          </section>
        )}

        {/* ================= PRIORS & VIEWS ================= */}
        {tab === "priors" && ds && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-1 font-semibold">Model parameters</h2>
              <p className="mb-4 text-xs text-slate-500">
                These shape the prior. Risk aversion scales the equilibrium returns implied by the
                benchmark weights; tau scales how much uncertainty you attach to that prior.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Risk aversion (δ)" hint="reverse-optimisation scalar">
                  <input type="number" step="0.1" min="0.1" className={inputCls} value={P.delta}
                         onChange={(e) => setParam("delta", Math.max(0.1, +e.target.value || 0.1))} />
                </Field>
                <Field label="Prior uncertainty (τ)" hint="typically 0.01 - 0.05">
                  <input type="number" step="0.01" min="0.001" className={inputCls} value={P.tau}
                         onChange={(e) => setParam("tau", Math.max(0.001, +e.target.value || 0.01))} />
                </Field>
                <Field label="Risk-free rate" hint="decimal, used for Sharpe">
                  <input type="number" step="0.005" className={inputCls} value={P.riskFree}
                         onChange={(e) => setParam("riskFree", +e.target.value || 0)} />
                </Field>
                <Field label="Min weight" hint="0 = long only">
                  <input type="number" step="0.01" className={inputCls} value={P.minW}
                         onChange={(e) => setParam("minW", +e.target.value || 0)} />
                </Field>
                <Field label="Max weight" hint={`cap per name (${ds.n} selected)`}>
                  <input type="number" step="0.01" min="0.001" max="1" className={inputCls} value={P.maxW}
                         onChange={(e) => setParam("maxW", Math.min(1, Math.max(0.001, +e.target.value || 0.01)))} />
                </Field>
              </div>
              {P.maxW * ds.n < 1 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={13} />
                  Max weight × {ds.n} names = {(P.maxW * ds.n).toFixed(2)} &lt; 1, so weights cannot
                  sum to 100%. Raise the cap or select fewer names.
                </p>
              )}
            </section>

            {/* ---- views ---- */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">Your views</h2>
                <button
                  onClick={() => setMyViews((v) => [...v, {
                    id: Math.random().toString(36).slice(2),
                    type: "absolute",
                    asset: ds.items[0]?.id,
                    vsAsset: ds.items[1]?.id,
                    value: unit.scale === 100 ? 0.12 : 0.0080,
                    confidence: 0.5,
                  }])}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Plus size={13} /> Add view
                </button>
              </div>
              <p className="mb-4 text-xs text-slate-500">
                An <b>absolute</b> view says "this asset returns X". A <b>relative</b> view says
                "this asset beats that one by X". Confidence sets Ω -- higher confidence pulls the
                posterior further from the prior.
              </p>

              {myViews.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  No views yet. With none, the posterior equals your prior and the optimiser just
                  returns a risk-adjusted version of the benchmark.
                </p>
              )}

              <div className="space-y-2">
                {myViews.map((v, i) => (
                  <div key={v.id}
                       className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-12 md:items-end">
                    <div className="md:col-span-2">
                      <Field label="Type">
                        <select className={inputCls} value={v.type}
                                onChange={(e) => setMyViews((vs) => vs.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                          <option value="absolute">Absolute</option>
                          <option value="relative">Relative</option>
                        </select>
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <Field label="Asset">
                        <input list={`assets-${assetClass}`} className={inputCls} value={v.asset}
                               onChange={(e) => setMyViews((vs) => vs.map((x, j) => j === i ? { ...x, asset: e.target.value.toUpperCase() } : x))} />
                      </Field>
                    </div>
                    {v.type === "relative" && (
                      <div className="md:col-span-3">
                        <Field label="Outperforms">
                          <input list={`assets-${assetClass}`} className={inputCls} value={v.vsAsset}
                                 onChange={(e) => setMyViews((vs) => vs.map((x, j) => j === i ? { ...x, vsAsset: e.target.value.toUpperCase() } : x))} />
                        </Field>
                      </div>
                    )}
                    <div className={v.type === "relative" ? "md:col-span-2" : "md:col-span-3"}>
                      <Field label={`By (${unit.suffix})`}>
                        <input type="number" step={unit.scale === 100 ? "0.5" : "5"} className={inputCls}
                               value={+(v.value * unit.scale).toFixed(unit.dp)}
                               onChange={(e) => setMyViews((vs) => vs.map((x, j) => j === i ? { ...x, value: (+e.target.value || 0) / unit.scale } : x))} />
                      </Field>
                    </div>
                    <div className="md:col-span-2">
                      <Field label={`Confidence ${Math.round(v.confidence * 100)}%`}>
                        <input type="range" min="0.05" max="0.95" step="0.05" className="w-full accent-blue-600"
                               value={v.confidence}
                               onChange={(e) => setMyViews((vs) => vs.map((x, j) => j === i ? { ...x, confidence: +e.target.value } : x))} />
                      </Field>
                    </div>
                    <div className="flex justify-end md:col-span-12 lg:col-span-1">
                      <button onClick={() => setMyViews((vs) => vs.filter((_, j) => j !== i))}
                              className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <datalist id={`assets-${assetClass}`}>
                {ds.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </datalist>
            </section>

            {/* ---- prior override ---- */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Equilibrium prior</h2>
                {overrideCount > 0 && (
                  <button onClick={() => setPriorOverrides((o) => ({ ...o, [assetClass]: {} }))}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
                    <RotateCcw size={12} /> Reset {overrideCount} override{overrideCount > 1 ? "s" : ""}
                  </button>
                )}
              </div>
              <p className="mb-4 text-xs text-slate-500">
                π = δ Σ w<sub>bmk</sub> -- the return the market already implies. Leave the override
                blank to use it, or type your own number to replace it before the views are blended in.
                Values in {unit.suffix} ({unit.label}).
              </p>

              <div className="max-h-[460px] overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-2 text-left">Asset</th>
                      <th className="p-2 text-left">Sector</th>
                      <th className="p-2 text-right">Bmk wt</th>
                      <th className="p-2 text-right">Implied π</th>
                      <th className="w-32 p-2 text-right">Your prior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ds.items.slice(0, ROW_CAP).map((it, i) => {
                      const ov = myOverrides[it.id];
                      return (
                        <tr key={it.id}
                            className={`border-t border-slate-100 ${ov != null ? "bg-amber-50/50" : ""}`}>
                          <td className="p-2">
                            <span className="font-semibold">{it.id}</span>
                            <span className="ml-2 text-xs text-slate-500">{it.name}</span>
                          </td>
                          <td className="p-2 text-xs text-slate-500">{it.sector}</td>
                          <td className="p-2 text-right tabular-nums">{pct(ds.wBmk[i], 2)}</td>
                          <td className="p-2 text-right tabular-nums text-slate-600">{fmt(equilibrium[i], unit)}</td>
                          <td className="p-1.5">
                            <input className={inputCls + " text-right"}
                                   placeholder={fmt(equilibrium[i], unit)}
                                   value={ov ?? ""}
                                   onChange={(e) => setOverride(it.id, e.target.value)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {ds.n > ROW_CAP && (
                <p className="mt-2 text-xs text-slate-500">
                  Showing the first {ROW_CAP} of {ds.n} selected names. All {ds.n} are used in the
                  optimisation, and overrides persist even when a row is scrolled out of the list.
                </p>
              )}
            </section>
          </div>
        )}

        {tab === "priors" && !ds && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Select at least two assets in the Universe tab first.
          </p>
        )}

        {/* ================= RESULTS ================= */}
        {tab === "results" && !myResults && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No results yet -- hit <b>Run Optimisation</b>.
          </p>
        )}
        {tab === "results" && myResults && (
          <Results r={myResults} unit={unit} params={P} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-4 gap-y-1 px-5 text-xs text-slate-500">
          <span>Runs entirely in your browser.</span>
          <a className="text-blue-600 hover:underline"
             href="https://github.com/SMcode-source/black-litterman">Source on GitHub</a>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function Results({ r, unit, params }) {
  const { stats, priorStats, extras, rows } = r;

  // Biggest active positions in either direction.
  const topActive = useMemo(
    () => [...rows]
      .sort((a, b) => Math.abs(b.active) - Math.abs(a.active))
      .slice(0, 20)
      .sort((a, b) => b.active - a.active)
      .map((x) => ({ id: x.id, active: x.active * 100 })),
    [rows]
  );

  const holdings = useMemo(
    () => [...rows].filter((x) => x.weight > 1e-6).sort((a, b) => b.weight - a.weight).slice(0, 25),
    [rows]
  );

  // Prior vs posterior: points off the diagonal are where the views bit.
  const shift = useMemo(
    () => rows
      .map((x) => ({
        id: x.id,
        prior: x.prior * unit.scale,
        posterior: x.posterior * unit.scale,
        moved: Math.abs(x.posterior - x.prior),
      }))
      .sort((a, b) => b.moved - a.moved)
      .slice(0, 120),
    [rows, unit.scale]
  );

  const heldCount = rows.filter((x) => x.weight > 1e-6).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Expected return" value={fmt(stats.ret, unit)} unit={unit.suffix}
              sub={`benchmark ${fmt(stats.bmkRet, unit)}${unit.suffix}`} tone="blue" />
        <Tile label="Volatility" value={fmt(stats.vol, unit)} unit={unit.suffix}
              sub={`benchmark ${fmt(stats.bmkVol, unit)}${unit.suffix}`} tone="amber" />
        <Tile label="Sharpe ratio" value={stats.sharpe.toFixed(2)}
              sub={`benchmark ${stats.bmkSharpe.toFixed(2)}`} tone="green" />
        <Tile label="Tracking error" value={fmt(stats.te, unit)} unit={unit.suffix}
              sub={`IR ${stats.ir.toFixed(2)}`} tone="violet" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="VaR 99%" value={fmt(stats.var99, unit)} unit={unit.suffix}
              sub="parametric, one-tail" tone="rose" />
        {extras ? (
          <>
            <Tile label="Expected loss" value={extras.expectedLoss.toFixed(1)} unit="bp" sub="PD × LGD weighted" />
            <Tile label="Spread duration" value={extras.spreadDur.toFixed(2)} unit="yr" sub="portfolio level" />
            <Tile label="DTS" value={extras.dts.toFixed(0)} sub="duration × spread" />
          </>
        ) : (
          <>
            <Tile label="Names held" value={heldCount} sub={`of ${r.n} selected`} />
            <Tile label="Benchmark Sharpe" value={priorStats.sharpe.toFixed(2)} sub="on your prior returns" />
            <Tile label="Solve time" value={r.ms} unit="ms" sub={`${r.iters} iterations`} />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
          {r.n} assets · {r.viewCount} view{r.viewCount === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
          Solved in {r.ms} ms ({r.iters} iterations)
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
          δ {params.delta} · τ {params.tau} · cap {pct(params.maxW, 0)}
        </span>
        {r.singular && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
            Views were collinear -- posterior fell back to the prior
          </span>
        )}
      </div>

      {r.viewImpact?.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 font-semibold">How far each view moved the posterior</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-2 text-left">View</th>
                  <th className="p-2 text-right">Prior implied</th>
                  <th className="p-2 text-right">You said</th>
                  <th className="p-2 text-right">Posterior</th>
                </tr>
              </thead>
              <tbody>
                {r.viewImpact.map((v, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 font-medium">#{i + 1}</td>
                    <td className="p-2 text-right tabular-nums text-slate-500">{fmt(v.before, unit)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{fmt(v.target, unit)}</td>
                    <td className="p-2 text-right tabular-nums text-blue-700">{fmt(v.after, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 font-semibold">Active weights (optimal − benchmark)</h3>
        <p className="mb-3 text-xs text-slate-500">20 largest active positions, in percentage points.</p>
        <div style={{ height: 380 }}>
          <ResponsiveContainer>
            <BarChart data={topActive} layout="vertical" margin={{ left: 12, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
              <YAxis type="category" dataKey="id" width={58} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [`${(+v).toFixed(2)}%`, "active"]} />
              <ReferenceLine x={0} stroke="#94a3b8" />
              <Bar dataKey="active" radius={[0, 3, 3, 0]}>
                {topActive.map((d, i) => (
                  <Cell key={i} fill={d.active >= 0 ? "#3b82f6" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-1 font-semibold">Prior vs posterior returns</h3>
          <p className="mb-3 text-xs text-slate-500">Points on the diagonal were untouched by your views.</p>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="prior" tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="posterior" tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow">
                        <div className="font-semibold">{d.id}</div>
                        <div>prior {d.prior.toFixed(unit.dp)}{unit.suffix}</div>
                        <div>posterior {d.posterior.toFixed(unit.dp)}{unit.suffix}</div>
                      </div>
                    );
                  }} />
                <Scatter data={shift} fill="#6366f1" fillOpacity={0.65} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-1 font-semibold">Sector allocation</h3>
          <p className="mb-3 text-xs text-slate-500">Optimal versus benchmark.</p>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart
                data={r.sectors.map((s) => ({
                  group: s.group, optimal: s.optimal * 100, benchmark: s.benchmark * 100 }))}
                margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="group" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${(+v).toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="benchmark" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="optimal" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {r.ratings && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 font-semibold">Rating distribution</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={r.ratings.map((s) => ({
                group: s.group, optimal: s.optimal * 100, benchmark: s.benchmark * 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${(+v).toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="benchmark" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="optimal" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 font-semibold">Top holdings</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-2 text-left">Asset</th>
                <th className="p-2 text-left">Sector</th>
                <th className="p-2 text-right">Prior</th>
                <th className="p-2 text-right">Posterior</th>
                <th className="p-2 text-right">Benchmark</th>
                <th className="p-2 text-right">Optimal</th>
                <th className="p-2 text-right">Active</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="p-2">
                    <span className="font-semibold">{h.id}</span>
                    <span className="ml-2 text-xs text-slate-500">{h.name}</span>
                  </td>
                  <td className="p-2 text-xs text-slate-500">{h.sector}</td>
                  <td className="p-2 text-right tabular-nums text-slate-500">{fmt(h.prior, unit)}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(h.posterior, unit)}</td>
                  <td className="p-2 text-right tabular-nums text-slate-500">{pct(h.bmk, 2)}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{pct(h.weight, 2)}</td>
                  <td className={`p-2 text-right font-medium tabular-nums ${
                        h.active >= 0 ? "text-blue-600" : "text-rose-600"}`}>
                    {h.active >= 0 ? "+" : ""}{pct(h.active, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
