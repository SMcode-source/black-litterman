/**
 * Black-Litterman Credit Optimiser — Main App
 * =============================================
 * Single-page React app with three tabs:
 *   1. Universe  — View/upload the bond universe
 *   2. Views     — Define manager return views
 *   3. Results   — Run optimisation and see charts/metrics
 *
 * Supports two compute modes:
 *   - Python backend (cvxpy + Monte Carlo) when API_URL is set
 *   - Browser JS fallback (gradient projection) otherwise
 */
import { useState, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, Legend, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from "recharts";
import {
  Settings, Eye, BarChart3, Play, Plus, Trash2,
  ChevronDown, ChevronUp, Server, Cpu, Loader2,
  Upload, FileSpreadsheet, X, RotateCcw,
} from "lucide-react";

import { SAMPLE_BONDS, SECTOR_COLORS } from "./constants";
import {
  generateCovarianceMatrix, computeEquilibrium, buildViewMatrices,
  computePosterior, optimisePortfolio, computeRiskMetrics,
} from "./engine";

// ---------------------------------------------------------------------------
// Config: set VITE_API_URL at build time to connect to the Python backend
// ---------------------------------------------------------------------------
const API_URL = import.meta.env.VITE_API_URL || "";

/** Send bond universe + views to the Python backend for optimisation. */
async function callBackendOptimise(bonds, views, params) {
  const payload = {
    bonds: bonds.map(b => ({
      id: b.id, issuer: b.issuer, sector: b.sector, rating: b.rating,
      oas: b.oas, spread_duration: b.spreadDur, pd_annual: b.pd,
      lgd: b.lgd, mkt_value: b.mktValue, maturity_bucket: b.matBucket,
    })),
    views: views.map(v => ({
      view_type: v.type, long_assets: v.longAssets, short_assets: v.shortAssets,
      magnitude_bp: v.magnitude, confidence: v.confidence,
    })),
    constraints: {
      max_issuer_weight: params.maxIssuerWeight,
      min_position_size: params.minPositionSize,
      max_tracking_error: 150, max_sector_overweight: 10,
      spread_duration_tolerance: 0.25,
    },
    delta: params.delta, tau: params.tau,
    n_simulations: 50000,
    covariance_method: "factor_model",
  };
  const res = await fetch(`${API_URL}/api/v1/optimise`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Reusable UI components
// ---------------------------------------------------------------------------
const Tab = ({ label, active, onClick, icon: Icon }) => (
  <button onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${active ? "bg-blue-600 text-white shadow-md" : "text-gray-600 hover:bg-gray-100"}`}>
    {Icon && <Icon size={16} />}{label}
  </button>
);

const MetricCard = ({ label, value, unit, sub, color = "blue" }) => {
  const colors = { blue: "border-blue-200 bg-blue-50", green: "border-green-200 bg-green-50", amber: "border-amber-200 bg-amber-50", red: "border-red-200 bg-red-50", purple: "border-purple-200 bg-purple-50" };
  return (
    <div className={`border rounded-xl p-4 ${colors[color]}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
};

// ===========================================================================
// Main App
// ===========================================================================
export default function App() {
  // --- State ---
  const [tab, setTab] = useState("universe");       // active tab
  const [bonds, setBonds] = useState(SAMPLE_BONDS);  // current bond universe
  const [views, setViews] = useState([
    { type: "RELATIVE", longAssets: ["JPM", "GS"], shortAssets: ["T", "VZ"], magnitude: 30, confidence: 0.6 },
    { type: "ABSOLUTE", longAssets: ["F"], shortAssets: [], magnitude: 80, confidence: 0.4 },
  ]);
  const [params, setParams] = useState({
    delta: 2.5, tau: 0.025, maxIssuerWeight: 8, minPositionSize: 0.2,
  });
  const [results, setResults] = useState(null);       // optimisation output
  const [showParams, setShowParams] = useState(false); // parameter panel toggle
  const [loading, setLoading] = useState(false);
  const [engineMode, setEngineMode] = useState(API_URL ? "python" : "browser");
  const [backendWarnings, setBackendWarnings] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState("replace"); // "replace" or "append"
  const [uploadResult, setUploadResult] = useState(null);

  // Recompute covariance whenever bond universe changes
  const covMatrix = useMemo(() => generateCovarianceMatrix(bonds), [bonds]);

  // --- Run BL pipeline in the browser (JS fallback) ---
  const runLocalOptimisation = useCallback(() => {
    const { wMkt, pi } = computeEquilibrium(bonds, covMatrix, params.delta);
    const viewData = buildViewMatrices(views, bonds, covMatrix, params.tau);
    const { muBL, sigmaBL } = computePosterior(pi, covMatrix, params.tau, viewData);
    const w = optimisePortfolio(muBL, sigmaBL, params.delta, bonds, params);
    const risk = computeRiskMetrics(w, bonds, covMatrix, muBL);
    return { wMkt, pi, muBL, sigmaBL, w, risk, solverStatus: "js_gradient_projection" };
  }, [bonds, covMatrix, views, params]);

  // --- Main "Run" handler: try backend, fall back to browser ---
  const runOptimisation = useCallback(async () => {
    setLoading(true);
    setBackendWarnings([]);
    try {
      if (engineMode === "python" && API_URL) {
        const apiResult = await callBackendOptimise(bonds, views, params);
        const totalMV = bonds.reduce((s, b) => s + b.mktValue, 0);
        const wMkt = bonds.map(b => b.mktValue / totalMV);
        const w = apiResult.issuer_results.map(r => r.optimal_weight / 100);
        const pi = apiResult.issuer_results.map(r => r.equilibrium_return_bp / 10000);
        const muBL = apiResult.issuer_results.map(r => r.posterior_return_bp / 10000);
        const risk = {
          portReturn: apiResult.risk_metrics.portfolio_return_bp,
          portVol: apiResult.risk_metrics.portfolio_vol_bp,
          sharpe: apiResult.risk_metrics.sharpe_ratio,
          te: apiResult.risk_metrics.tracking_error_bp,
          ir: apiResult.risk_metrics.information_ratio,
          el: apiResult.risk_metrics.expected_loss_bp,
          portSpreadDur: apiResult.risk_metrics.spread_duration,
          dts: apiResult.risk_metrics.dts,
          creditVaR: apiResult.risk_metrics.credit_var_99_bp,
          creditCVaR: apiResult.risk_metrics.credit_cvar_99_bp,
          sectorWeights: {}, sectorBmkWeights: {}, ratingWeights: {}, ratingBmkWeights: {},
          activeW: w.map((wi, i) => wi - wMkt[i]), wBmk: wMkt,
        };
        apiResult.sector_allocation.forEach(s => { risk.sectorWeights[s.sector] = s.optimal / 100; risk.sectorBmkWeights[s.sector] = s.benchmark / 100; });
        apiResult.rating_allocation.forEach(r => { risk.ratingWeights[r.rating_bucket] = r.optimal / 100; risk.ratingBmkWeights[r.rating_bucket] = r.benchmark / 100; });
        setBackendWarnings(apiResult.warnings || []);
        setResults({ wMkt, pi, muBL, w, risk, solverStatus: apiResult.solver_status, varDistribution: apiResult.var_distribution });
      } else {
        setResults(runLocalOptimisation());
      }
    } catch (err) {
      console.warn("Backend call failed, falling back to browser engine:", err.message);
      setBackendWarnings([`Backend unavailable (${err.message}). Using browser-based engine.`]);
      setEngineMode("browser");
      setResults(runLocalOptimisation());
    }
    setLoading(false);
    setTab("results");
  }, [bonds, views, params, engineMode, runLocalOptimisation]);

  // --- Upload handler: send file to backend, update bond universe ---
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/api/v1/upload-bonds`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || `Upload failed: ${res.status}`);
      }
      const data = await res.json();
      setUploadResult(data);
      if (data.status === "success" && data.bonds.length > 0) {
        const newBonds = data.bonds.map(b => ({
          id: b.id, issuer: b.issuer, sector: b.sector, rating: b.rating,
          oas: b.oas, spreadDur: b.spread_duration, pd: b.pd_annual,
          lgd: b.lgd, mktValue: b.mkt_value, matBucket: b.maturity_bucket,
          ytm: b.ytm, couponRate: b.coupon_rate, maturityDate: b.maturity_date,
          faceValue: b.face_value, marketPrice: b.market_price,
        }));
        if (uploadMode === "replace") {
          setBonds(newBonds);
        } else {
          const existingIds = new Set(bonds.map(b => b.id));
          const unique = newBonds.filter(b => !existingIds.has(b.id));
          const dupes = newBonds.length - unique.length;
          if (dupes > 0) {
            setUploadResult(prev => ({ ...prev, warnings: [...(prev?.warnings || []), `${dupes} duplicate ID(s) skipped during append.`] }));
          }
          setBonds(prev => [...prev, ...unique]);
        }
        setResults(null);
      }
    } catch (err) {
      setUploadResult({ status: "error", bonds: [], row_count: 0, warnings: [], errors: [err.message] });
    }
    setUploading(false);
    e.target.value = "";
  }, [uploadMode, bonds]);

  const resetToSampleBonds = useCallback(() => {
    setBonds(SAMPLE_BONDS);
    setResults(null);
    setUploadResult(null);
  }, []);

  const addView = () => setViews([...views, { type: "ABSOLUTE", longAssets: [bonds[0].id], shortAssets: [], magnitude: 50, confidence: 0.5 }]);
  const removeView = (i) => setViews(views.filter((_, j) => j !== i));
  const updateView = (i, field, val) => { const v = [...views]; v[i] = { ...v[i], [field]: val }; setViews(v); };

  // ===========================================================================
  // Tab: Universe — bond table + file upload
  // ===========================================================================
  const UniversePanel = () => (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Bond Universe</h2>
          <p className="text-sm text-gray-500">{bonds.length} investment grade issuers loaded</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">Avg OAS: {Math.round(bonds.reduce((s, b) => s + b.oas, 0) / bonds.length)} bp</span>
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">Avg SD: {(bonds.reduce((s, b) => s + b.spreadDur, 0) / bonds.length).toFixed(1)}y</span>
        </div>
      </div>

      {/* File Upload Section */}
      {API_URL && (
        <div className="mb-4 border border-dashed border-gray-300 rounded-xl p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Upload Bond Universe</span>
              <span className="text-xs text-gray-400">CSV, TXT, or Excel</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden text-xs">
                <button onClick={() => setUploadMode("replace")}
                  className={`px-3 py-1.5 font-medium transition-colors ${uploadMode === "replace" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                  Replace
                </button>
                <button onClick={() => setUploadMode("append")}
                  className={`px-3 py-1.5 font-medium transition-colors ${uploadMode === "append" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                  Append
                </button>
              </div>
              {bonds !== SAMPLE_BONDS && (
                <button onClick={resetToSampleBonds}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-white transition-colors">
                  <RotateCcw size={12} /> Reset to sample
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${uploading ? "border-blue-300 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50"}`}>
              {uploading ? <Loader2 size={16} className="animate-spin text-blue-600" /> : <Upload size={16} className="text-gray-400" />}
              <span className="text-sm text-gray-600">{uploading ? "Parsing file..." : "Choose file or drag & drop"}</span>
              <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={handleFileUpload} className="hidden" disabled={uploading} />
            </label>
          </div>
          <div className="mt-2 text-xs text-gray-400">
            <span className="font-medium">Required:</span> id/issuer. <span className="font-medium">Optional:</span> coupon_rate, maturity_date, face_value, price, yield/ytm, oas, spread_duration, rating, sector, pd, lgd, mkt_value.
            Missing yield is calculated from coupon + price + maturity. Missing OAS/spread_duration are estimated.
          </div>

          {/* Upload feedback */}
          {uploadResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${uploadResult.status === "success" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
              <div className="flex items-center justify-between">
                <span className={`font-medium ${uploadResult.status === "success" ? "text-green-700" : "text-red-700"}`}>
                  {uploadResult.status === "success"
                    ? `${uploadResult.row_count} bond(s) loaded successfully (${uploadMode === "replace" ? "replaced" : "appended"})`
                    : "Upload failed"}
                </span>
                <button onClick={() => setUploadResult(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
              {uploadResult.errors?.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {uploadResult.errors.slice(0, 5).map((e, i) => (
                    <div key={i} className="text-xs text-red-600">{e}</div>
                  ))}
                  {uploadResult.errors.length > 5 && <div className="text-xs text-red-500">...and {uploadResult.errors.length - 5} more</div>}
                </div>
              )}
              {uploadResult.warnings?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-amber-600 cursor-pointer font-medium">{uploadResult.warnings.length} warning(s)</summary>
                  <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {uploadResult.warnings.map((w, i) => (
                      <div key={i} className="text-xs text-amber-600">{w}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2.5 font-medium text-gray-600">Ticker</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Issuer</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Sector</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Rating</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-right">OAS (bp)</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Spd Dur</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-right">PD (bp)</th>
              {bonds.some(b => b.ytm != null) && <th className="px-3 py-2.5 font-medium text-gray-600 text-right">YTM%</th>}
              {bonds.some(b => b.couponRate != null) && <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Coupon%</th>}
              <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Bmk Wt%</th>
              {results && <th className="px-3 py-2.5 font-medium text-blue-700 text-right">Opt Wt%</th>}
              {results && <th className="px-3 py-2.5 font-medium text-blue-700 text-right">Active%</th>}
            </tr>
          </thead>
          <tbody>
            {bonds.map((b, i) => {
              const totalMV = bonds.reduce((s, x) => s + x.mktValue, 0);
              const bmkW = (b.mktValue / totalMV * 100);
              const optW = results ? results.w[i] * 100 : null;
              const active = results ? (results.w[i] - results.wMkt[i]) * 100 : null;
              return (
                <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2 font-mono font-semibold text-gray-900">{b.id}</td>
                  <td className="px-3 py-2 text-gray-700">{b.issuer}</td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (SECTOR_COLORS[b.sector] || "#888") + "20", color: SECTOR_COLORS[b.sector] || "#888" }}>{b.sector}</span></td>
                  <td className="px-3 py-2 font-mono text-gray-700">{b.rating}</td>
                  <td className="px-3 py-2 text-right font-mono">{b.oas}</td>
                  <td className="px-3 py-2 text-right font-mono">{b.spreadDur.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(b.pd * 10000).toFixed(1)}</td>
                  {bonds.some(x => x.ytm != null) && <td className="px-3 py-2 text-right font-mono">{b.ytm != null ? b.ytm.toFixed(2) : "\u2014"}</td>}
                  {bonds.some(x => x.couponRate != null) && <td className="px-3 py-2 text-right font-mono">{b.couponRate != null ? b.couponRate.toFixed(2) : "\u2014"}</td>}
                  <td className="px-3 py-2 text-right font-mono">{bmkW.toFixed(2)}</td>
                  {results && <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">{optW.toFixed(2)}</td>}
                  {results && <td className={`px-3 py-2 text-right font-mono font-semibold ${active > 0.01 ? "text-green-600" : active < -0.01 ? "text-red-500" : "text-gray-400"}`}>{active > 0 ? "+" : ""}{active.toFixed(2)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ===========================================================================
  // Tab: Views — define absolute/relative manager views
  // ===========================================================================
  const ViewsPanel = () => (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Portfolio Manager Views</h2>
          <p className="text-sm text-gray-500">Express absolute or relative spread return views</p>
        </div>
        <button onClick={addView} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus size={16} /> Add View
        </button>
      </div>
      <div className="space-y-4">
        {views.map((v, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700">View {i + 1}</span>
              <button onClick={() => removeView(i)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select value={v.type} onChange={e => updateView(i, "type", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="ABSOLUTE">Absolute</option>
                  <option value="RELATIVE">Relative</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Magnitude (bp)</label>
                <input type="number" value={v.magnitude} onChange={e => updateView(i, "magnitude", +e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Long Asset(s)</label>
                <select multiple value={v.longAssets} onChange={e => updateView(i, "longAssets", [...e.target.selectedOptions].map(o => o.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm h-20">
                  {bonds.map(b => <option key={b.id} value={b.id}>{b.id} - {b.issuer}</option>)}
                </select>
              </div>
              <div>
                {v.type === "RELATIVE" ? (
                  <>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Short Asset(s)</label>
                    <select multiple value={v.shortAssets} onChange={e => updateView(i, "shortAssets", [...e.target.selectedOptions].map(o => o.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm h-20">
                      {bonds.map(b => <option key={b.id} value={b.id}>{b.id} - {b.issuer}</option>)}
                    </select>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-gray-400 italic">No short leg for absolute views</div>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Confidence: {(v.confidence * 100).toFixed(0)}%</label>
                <input type="range" min="0.05" max="1" step="0.05" value={v.confidence}
                  onChange={e => updateView(i, "confidence", +e.target.value)}
                  className="w-full accent-blue-600" />
                <div className="flex justify-between text-xs text-gray-400"><span>Low</span><span>High</span></div>
              </div>
            </div>
            <div className="mt-3 p-2 bg-gray-50 rounded-lg text-xs text-gray-600">
              {v.type === "ABSOLUTE"
                ? `Expects ${v.longAssets.join(", ")} to deliver ${v.magnitude} bp excess spread return`
                : `Expects ${v.longAssets.join(", ")} to outperform ${v.shortAssets.join(", ")} by ${v.magnitude} bp`}
              {` (${(v.confidence * 100).toFixed(0)}% confidence)`}
            </div>
          </div>
        ))}
        {views.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Eye size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No views defined. Add views or run with equilibrium returns only.</p>
          </div>
        )}
      </div>
    </div>
  );

  // ===========================================================================
  // Tab: Results — metrics cards + charts
  // ===========================================================================
  const ResultsPanel = () => {
    if (!results) return (
      <div className="text-center py-20 text-gray-400">
        <BarChart3 size={48} className="mx-auto mb-3 opacity-40" />
        <p className="text-lg font-medium">No results yet</p>
        <p className="text-sm mt-1">Configure views and click "Run Optimisation"</p>
      </div>
    );

    const { w, risk, muBL, pi, wMkt } = results;

    const weightData = bonds.map((b, i) => ({
      name: b.id, optimal: +(w[i] * 100).toFixed(2), benchmark: +(wMkt[i] * 100).toFixed(2), active: +((w[i] - wMkt[i]) * 100).toFixed(2)
    })).sort((a, b) => b.active - a.active);

    const sectorData = Object.entries(risk.sectorWeights).map(([sector, wt]) => ({
      name: sector, optimal: +(wt * 100).toFixed(1), benchmark: +(risk.sectorBmkWeights[sector] * 100).toFixed(1),
    }));

    const ratingData = ["AAA", "AA", "A", "BBB"].map(r => ({
      name: r, optimal: +((risk.ratingWeights[r] || 0) * 100).toFixed(1), benchmark: +((risk.ratingBmkWeights[r] || 0) * 100).toFixed(1),
    }));

    const returnData = bonds.map((b, i) => ({
      name: b.id, equilibrium: +(pi[i] * 10000).toFixed(1), posterior: +(muBL[i] * 10000).toFixed(1), oas: b.oas,
    })).sort((a, b) => b.posterior - a.posterior);

    const riskReturnData = bonds.map((b, i) => ({
      name: b.id, x: Math.sqrt(covMatrix[i][i]) * 10000, y: muBL[i] * 10000, z: w[i] * 100, sector: b.sector,
    }));

    return (
      <div className="space-y-6">
        {/* Summary Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Expected Return" value={(risk.portReturn).toFixed(1)} unit="bp" sub="Spread return (ann.)" color="blue" />
          <MetricCard label="Portfolio Risk" value={(risk.portVol).toFixed(1)} unit="bp" sub="Spread return vol (ann.)" color="amber" />
          <MetricCard label="Sharpe Ratio" value={risk.sharpe.toFixed(2)} sub="Return / Risk" color="green" />
          <MetricCard label="Tracking Error" value={risk.te.toFixed(1)} unit="bp" sub="vs. benchmark (ann.)" color="purple" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Information Ratio" value={risk.ir.toFixed(2)} sub="Active return / TE" color="green" />
          <MetricCard label="Expected Loss" value={risk.el.toFixed(1)} unit="bp" sub="PD x LGD weighted" color="red" />
          <MetricCard label="Spread Duration" value={risk.portSpreadDur.toFixed(2)} unit="yr" sub="Portfolio level" color="blue" />
          <MetricCard label="Credit VaR (99%)" value={(risk.creditVaR || 0).toFixed(0)} unit="bp" sub={risk.creditCVaR ? `CVaR: ${risk.creditCVaR.toFixed(0)} bp (Monte Carlo)` : "Parametric 1-year"} color="red" />
        </div>

        {/* Solver & warnings */}
        {(results.solverStatus || backendWarnings.length > 0) && (
          <div className="flex flex-wrap gap-2 items-center">
            {results.solverStatus && <span className={`px-2 py-1 rounded-full text-xs font-medium ${results.solverStatus === "optimal" ? "bg-green-100 text-green-700" : results.solverStatus.includes("js") ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>Solver: {results.solverStatus}</span>}
            {engineMode === "python" && API_URL && <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Python backend (cvxpy + Monte Carlo)</span>}
            {engineMode === "browser" && <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Browser engine (JS)</span>}
            {backendWarnings.map((w, i) => <span key={i} className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{w}</span>)}
          </div>
        )}

        {/* Active Weights Chart */}
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Active Weights (Optimal - Benchmark)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={weightData} layout="vertical" margin={{ left: 40, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={v => `${v}%`} fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={45} />
              <Tooltip formatter={v => `${v}%`} />
              <ReferenceLine x={0} stroke="#94a3b8" />
              <Bar dataKey="active" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                {weightData.map((d, i) => <Cell key={i} fill={d.active >= 0 ? "#3b82f6" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sector Allocation */}
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Sector Allocation</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sectorData} margin={{ left: 10, right: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" fontSize={10} angle={-35} textAnchor="end" interval={0} />
                <YAxis tickFormatter={v => `${v}%`} fontSize={11} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend fontSize={11} />
                <Bar dataKey="benchmark" fill="#cbd5e1" name="Benchmark" radius={[2, 2, 0, 0]} />
                <Bar dataKey="optimal" fill="#3b82f6" name="Optimal" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Rating Allocation */}
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Rating Distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ratingData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis tickFormatter={v => `${v}%`} fontSize={11} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend fontSize={11} />
                <Bar dataKey="benchmark" fill="#cbd5e1" name="Benchmark" radius={[2, 2, 0, 0]} />
                <Bar dataKey="optimal" fill="#8b5cf6" name="Optimal" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Equilibrium vs Posterior Returns */}
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Equilibrium vs. Posterior Expected Returns (bp)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={returnData} layout="vertical" margin={{ left: 40, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={11} width={45} />
              <Tooltip />
              <Legend fontSize={11} />
              <Bar dataKey="equilibrium" fill="#cbd5e1" name="Equilibrium" radius={[0, 2, 2, 0]} />
              <Bar dataKey="posterior" fill="#3b82f6" name="Posterior" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Risk-Return Scatter */}
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Risk-Return Scatter (bubble size = optimal weight)</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ left: 10, right: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="x" type="number" name="Risk (bp)" fontSize={11} label={{ value: "Risk (bp vol)", position: "bottom", fontSize: 11 }} />
              <YAxis dataKey="y" type="number" name="Return (bp)" fontSize={11} label={{ value: "Return (bp)", angle: -90, position: "insideLeft", fontSize: 11 }} />
              <ZAxis dataKey="z" range={[20, 400]} name="Weight %" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v, name) => name === "Weight %" ? `${v.toFixed(2)}%` : `${v.toFixed(0)} bp`} />
              <Scatter data={riskReturnData} fill="#3b82f6" fillOpacity={0.7}>
                {riskReturnData.map((d, i) => <Cell key={i} fill={SECTOR_COLORS[d.sector] || "#888"} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {Object.entries(SECTOR_COLORS).map(([s, c]) => (
              <div key={s} className="flex items-center gap-1 text-xs text-gray-600">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />{s}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Black-Litterman Credit Optimiser</h1>
              <p className="text-xs text-gray-500 mt-0.5">Investment Grade Corporate Bond Portfolio</p>
            </div>
            <div className="flex items-center gap-3">
              {API_URL && (
                <button onClick={() => setEngineMode(m => m === "python" ? "browser" : "python")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${engineMode === "python" ? "border-green-300 bg-green-50 text-green-700" : "border-gray-300 bg-gray-50 text-gray-600"}`}>
                  {engineMode === "python" ? <Server size={13} /> : <Cpu size={13} />}
                  {engineMode === "python" ? "Python (cvxpy)" : "Browser (JS)"}
                </button>
              )}
              <button onClick={() => setShowParams(!showParams)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                <Settings size={15} />{showParams ? "Hide" : "Parameters"}{showParams ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button onClick={runOptimisation} disabled={loading}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all active:scale-95 disabled:opacity-60">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {loading ? "Running..." : "Run Optimisation"}
              </button>
            </div>
          </div>

          {/* Parameters Panel */}
          {showParams && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Risk Aversion (delta)</label>
                <input type="number" step="0.1" value={params.delta} onChange={e => setParams({ ...params, delta: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prior Uncertainty (tau)</label>
                <input type="number" step="0.005" value={params.tau} onChange={e => setParams({ ...params, tau: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Max Issuer Weight (%)</label>
                <input type="number" step="0.5" value={params.maxIssuerWeight} onChange={e => setParams({ ...params, maxIssuerWeight: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Min Position Size (%)</label>
                <input type="number" step="0.05" value={params.minPositionSize} onChange={e => setParams({ ...params, minPositionSize: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="max-w-7xl mx-auto px-6 pt-4">
        <div className="flex gap-2 mb-4 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm w-fit">
          <Tab label="Universe" icon={Settings} active={tab === "universe"} onClick={() => setTab("universe")} />
          <Tab label="Views" icon={Eye} active={tab === "views"} onClick={() => setTab("views")} />
          <Tab label="Results" icon={BarChart3} active={tab === "results"} onClick={() => setTab("results")} />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {tab === "universe" && <UniversePanel />}
          {tab === "views" && <ViewsPanel />}
          {tab === "results" && <ResultsPanel />}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-xs text-gray-400">
        Black-Litterman Credit Optimiser v1.0 &middot; Bayesian posterior blending with credit-specific risk framework
      </div>
    </div>
  );
}
