import { useState, useMemo, useCallback } from "react";
import * as math from "mathjs";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, ReferenceLine
} from "recharts";
import { Settings, TrendingUp, Eye, BarChart3, AlertTriangle, Play, Plus, Trash2, Info, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// SAMPLE IG BOND UNIVERSE
// ═══════════════════════════════════════════════════════════════════
const SAMPLE_BONDS = [
  { id: "AAPL", issuer: "Apple Inc.", sector: "Technology", rating: "AA+", oas: 45, spreadDur: 4.2, pd: 0.0003, lgd: 0.4, mktValue: 5200, matBucket: "3-5y" },
  { id: "MSFT", issuer: "Microsoft Corp.", sector: "Technology", rating: "AAA", oas: 35, spreadDur: 5.1, pd: 0.0001, lgd: 0.4, mktValue: 6100, matBucket: "5-7y" },
  { id: "JPM", issuer: "JPMorgan Chase", sector: "Financials", rating: "A+", oas: 72, spreadDur: 3.8, pd: 0.0008, lgd: 0.45, mktValue: 4800, matBucket: "3-5y" },
  { id: "BAC", issuer: "Bank of America", sector: "Financials", rating: "A", oas: 85, spreadDur: 4.5, pd: 0.0012, lgd: 0.45, mktValue: 4200, matBucket: "3-5y" },
  { id: "GS", issuer: "Goldman Sachs", sector: "Financials", rating: "A+", oas: 78, spreadDur: 3.2, pd: 0.0010, lgd: 0.45, mktValue: 3100, matBucket: "3-5y" },
  { id: "JNJ", issuer: "Johnson & Johnson", sector: "Healthcare", rating: "AAA", oas: 32, spreadDur: 6.0, pd: 0.0001, lgd: 0.4, mktValue: 4500, matBucket: "5-7y" },
  { id: "PFE", issuer: "Pfizer Inc.", sector: "Healthcare", rating: "A+", oas: 62, spreadDur: 4.8, pd: 0.0006, lgd: 0.4, mktValue: 3200, matBucket: "5-7y" },
  { id: "UNH", issuer: "UnitedHealth Group", sector: "Healthcare", rating: "A+", oas: 68, spreadDur: 5.5, pd: 0.0007, lgd: 0.4, mktValue: 3800, matBucket: "5-7y" },
  { id: "XOM", issuer: "Exxon Mobil", sector: "Energy", rating: "AA-", oas: 55, spreadDur: 4.0, pd: 0.0005, lgd: 0.4, mktValue: 3600, matBucket: "3-5y" },
  { id: "CVX", issuer: "Chevron Corp.", sector: "Energy", rating: "AA-", oas: 52, spreadDur: 3.5, pd: 0.0004, lgd: 0.4, mktValue: 3000, matBucket: "3-5y" },
  { id: "PG", issuer: "Procter & Gamble", sector: "Consumer Staples", rating: "AA-", oas: 40, spreadDur: 5.2, pd: 0.0002, lgd: 0.4, mktValue: 3900, matBucket: "5-7y" },
  { id: "KO", issuer: "Coca-Cola Co.", sector: "Consumer Staples", rating: "A+", oas: 48, spreadDur: 4.6, pd: 0.0004, lgd: 0.4, mktValue: 3400, matBucket: "3-5y" },
  { id: "T", issuer: "AT&T Inc.", sector: "Communications", rating: "BBB", oas: 125, spreadDur: 6.8, pd: 0.0035, lgd: 0.45, mktValue: 4100, matBucket: "7-10y" },
  { id: "VZ", issuer: "Verizon Comms.", sector: "Communications", rating: "BBB+", oas: 105, spreadDur: 6.2, pd: 0.0025, lgd: 0.45, mktValue: 3700, matBucket: "7-10y" },
  { id: "NEE", issuer: "NextEra Energy", sector: "Utilities", rating: "A-", oas: 70, spreadDur: 5.0, pd: 0.0009, lgd: 0.4, mktValue: 2800, matBucket: "5-7y" },
  { id: "D", issuer: "Dominion Energy", sector: "Utilities", rating: "BBB+", oas: 95, spreadDur: 5.8, pd: 0.0020, lgd: 0.4, mktValue: 2400, matBucket: "5-7y" },
  { id: "CAT", issuer: "Caterpillar Inc.", sector: "Industrials", rating: "A", oas: 58, spreadDur: 3.6, pd: 0.0007, lgd: 0.4, mktValue: 2600, matBucket: "3-5y" },
  { id: "HON", issuer: "Honeywell Int'l", sector: "Industrials", rating: "A", oas: 55, spreadDur: 4.1, pd: 0.0006, lgd: 0.4, mktValue: 2900, matBucket: "3-5y" },
  { id: "UNP", issuer: "Union Pacific", sector: "Industrials", rating: "A-", oas: 65, spreadDur: 5.3, pd: 0.0008, lgd: 0.4, mktValue: 2500, matBucket: "5-7y" },
  { id: "BLK", issuer: "BlackRock Inc.", sector: "Financials", rating: "A+", oas: 68, spreadDur: 3.9, pd: 0.0007, lgd: 0.45, mktValue: 2200, matBucket: "3-5y" },
  { id: "AMZN", issuer: "Amazon.com", sector: "Technology", rating: "AA", oas: 42, spreadDur: 4.7, pd: 0.0002, lgd: 0.4, mktValue: 4600, matBucket: "5-7y" },
  { id: "META", issuer: "Meta Platforms", sector: "Technology", rating: "AA-", oas: 50, spreadDur: 3.4, pd: 0.0003, lgd: 0.4, mktValue: 3300, matBucket: "3-5y" },
  { id: "BMY", issuer: "Bristol-Myers Squibb", sector: "Healthcare", rating: "A", oas: 75, spreadDur: 5.6, pd: 0.0010, lgd: 0.4, mktValue: 2700, matBucket: "5-7y" },
  { id: "F", issuer: "Ford Motor Co.", sector: "Consumer Disc.", rating: "BBB-", oas: 155, spreadDur: 4.2, pd: 0.0055, lgd: 0.5, mktValue: 2100, matBucket: "3-5y" },
  { id: "GM", issuer: "General Motors", sector: "Consumer Disc.", rating: "BBB", oas: 135, spreadDur: 3.8, pd: 0.0040, lgd: 0.5, mktValue: 2300, matBucket: "3-5y" },
];

const SECTORS = [...new Set(SAMPLE_BONDS.map(b => b.sector))];
const RATING_ORDER = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-"];
const COLORS = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#059669", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
const SECTOR_COLORS = { Technology: "#3b82f6", Financials: "#10b981", Healthcare: "#8b5cf6", Energy: "#f59e0b", "Consumer Staples": "#ec4899", Communications: "#ef4444", Utilities: "#14b8a6", Industrials: "#f97316", "Consumer Disc.": "#6366f1" };

// ═══════════════════════════════════════════════════════════════════
// MATRIX UTILITIES
// ═══════════════════════════════════════════════════════════════════
function generateCovarianceMatrix(bonds) {
  const n = bonds.length;
  const sectorMap = {};
  SECTORS.forEach((s, i) => sectorMap[s] = i);
  const cov = math.zeros(n, n)._data;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const bi = bonds[i], bj = bonds[j];
      const volI = (bi.oas / 10000) * bi.spreadDur * 0.3;
      const volJ = (bj.oas / 10000) * bj.spreadDur * 0.3;
      let corr = 0.15;
      if (bi.sector === bj.sector) corr = 0.55;
      const ratingDist = Math.abs(RATING_ORDER.indexOf(bi.rating) - RATING_ORDER.indexOf(bj.rating));
      corr += Math.max(0, 0.15 - ratingDist * 0.03);
      if (i === j) corr = 1.0;
      corr = Math.min(corr, 0.95);
      cov[i][j] = volI * volJ * corr;
      cov[j][i] = cov[i][j];
    }
  }
  return cov;
}

function matInverse(m) {
  try { return math.inv(m); }
  catch { const n = m.length; const reg = m.map((row, i) => row.map((v, j) => v + (i === j ? 1e-6 : 0))); return math.inv(reg); }
}

// ═══════════════════════════════════════════════════════════════════
// BLACK-LITTERMAN ENGINE
// ═══════════════════════════════════════════════════════════════════
function computeEquilibrium(bonds, covMatrix, delta) {
  const totalMV = bonds.reduce((s, b) => s + b.mktValue, 0);
  const wMkt = bonds.map(b => b.mktValue / totalMV);
  const pi = math.multiply(math.multiply(delta, covMatrix), wMkt);
  return { wMkt, pi };
}

function buildViewMatrices(views, bonds, covMatrix, tau) {
  if (!views.length) return null;
  const n = bonds.length;
  const k = views.length;
  const P = math.zeros(k, n)._data;
  const Q = [];

  views.forEach((v, vi) => {
    Q.push(v.magnitude / 10000);
    if (v.type === "ABSOLUTE") {
      const idx = bonds.findIndex(b => b.id === v.longAssets[0]);
      if (idx >= 0) P[vi][idx] = 1;
    } else {
      const longs = v.longAssets.filter(a => bonds.some(b => b.id === a));
      const shorts = v.shortAssets.filter(a => bonds.some(b => b.id === a));
      longs.forEach(a => { const idx = bonds.findIndex(b => b.id === a); if (idx >= 0) P[vi][idx] = 1 / longs.length; });
      shorts.forEach(a => { const idx = bonds.findIndex(b => b.id === a); if (idx >= 0) P[vi][idx] = -1 / shorts.length; });
    }
  });

  const omega = math.zeros(k, k)._data;
  for (let i = 0; i < k; i++) {
    const pRow = P[i];
    const pSigPt = math.multiply(math.multiply(pRow, covMatrix), pRow);
    const conf = views[i].confidence || 0.5;
    omega[i][i] = tau * pSigPt * (1 / conf - 1);
    if (omega[i][i] < 1e-12) omega[i][i] = 1e-12;
  }
  return { P, Q, omega };
}

function computePosterior(pi, covMatrix, tau, viewData) {
  const n = pi.length;
  const tauSigma = math.multiply(tau, covMatrix);
  const tauSigmaInv = matInverse(tauSigma);

  if (!viewData) {
    return { muBL: Array.from(pi), sigmaBL: math.add(covMatrix, tauSigma) };
  }

  const { P, Q, omega } = viewData;
  const omegaInv = matInverse(omega);
  const Pt = math.transpose(P);
  const PtOmegaInvP = math.multiply(math.multiply(Pt, omegaInv), P);
  const posteriorPrecision = math.add(tauSigmaInv, PtOmegaInvP);
  const posteriorCov = matInverse(posteriorPrecision);
  const term1 = math.multiply(tauSigmaInv, pi);
  const term2 = math.multiply(math.multiply(Pt, omegaInv), Q);
  const muBL = math.multiply(posteriorCov, math.add(term1, term2));
  const sigmaBL = math.add(covMatrix, posteriorCov);

  return { muBL: Array.isArray(muBL) ? muBL : muBL._data || [muBL], sigmaBL };
}

function optimisePortfolio(muBL, sigmaBL, delta, bonds, constraints) {
  const n = bonds.length;
  let w = muBL.map(() => 1 / n);

  // Gradient ascent with projection for: max w'μ - (δ/2) w'Σw
  const lr = 0.0005;
  const maxIter = 5000;

  for (let iter = 0; iter < maxIter; iter++) {
    const sigW = math.multiply(sigmaBL, w);
    const grad = math.subtract(muBL, math.multiply(delta, sigW));

    w = w.map((wi, i) => wi + lr * grad[i]);

    // Project: long-only, sum=1, max issuer weight
    const maxW = (constraints.maxIssuerWeight || 5) / 100;
    const minW = (constraints.minPositionSize || 0) / 100;
    w = w.map(wi => Math.max(minW, Math.min(maxW, wi)));
    const sum = w.reduce((a, b) => a + b, 0);
    w = w.map(wi => wi / sum);
  }

  return w;
}

// ═══════════════════════════════════════════════════════════════════
// RISK ANALYTICS
// ═══════════════════════════════════════════════════════════════════
function computeRiskMetrics(w, bonds, covMatrix, muBL) {
  const portReturn = math.dot(w, muBL) * 10000;
  const portVar = math.multiply(math.multiply(w, covMatrix), w);
  const portVol = Math.sqrt(portVar) * 10000;
  const sharpe = portVol > 0 ? portReturn / portVol : 0;

  const totalMV = bonds.reduce((s, b) => s + b.mktValue, 0);
  const wBmk = bonds.map(b => b.mktValue / totalMV);
  const activeW = w.map((wi, i) => wi - wBmk[i]);
  const te = Math.sqrt(math.multiply(math.multiply(activeW, covMatrix), activeW)) * 10000;
  const ir = te > 0 ? (portReturn - math.dot(wBmk, muBL) * 10000) / te : 0;

  const el = math.dot(w, bonds.map(b => b.pd * b.lgd)) * 10000;
  const dts = math.dot(w, bonds.map(b => (b.oas / 10000) * b.spreadDur)) * 10000;
  const portSpreadDur = math.dot(w, bonds.map(b => b.spreadDur));

  // Sector decomposition
  const sectorWeights = {};
  const sectorBmkWeights = {};
  bonds.forEach((b, i) => {
    sectorWeights[b.sector] = (sectorWeights[b.sector] || 0) + w[i];
    sectorBmkWeights[b.sector] = (sectorBmkWeights[b.sector] || 0) + wBmk[i];
  });

  // Rating decomposition
  const ratingWeights = {};
  const ratingBmkWeights = {};
  bonds.forEach((b, i) => {
    const bucket = b.rating.startsWith("AAA") ? "AAA" : b.rating.startsWith("AA") ? "AA" : b.rating.startsWith("A") ? "A" : "BBB";
    ratingWeights[bucket] = (ratingWeights[bucket] || 0) + w[i];
    ratingBmkWeights[bucket] = (ratingBmkWeights[bucket] || 0) + wBmk[i];
  });

  // Credit VaR (parametric approximation)
  const z99 = 2.326;
  const creditVaR = (portReturn - z99 * portVol);

  return { portReturn, portVol, sharpe, te, ir, el, dts, portSpreadDur, sectorWeights, sectorBmkWeights, ratingWeights, ratingBmkWeights, creditVaR, activeW, wBmk };
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════
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

const Tooltip2 = ({ text, children }) => (
  <div className="group relative inline-flex items-center">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">{text}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("universe");
  const [bonds, setBonds] = useState(SAMPLE_BONDS);
  const [views, setViews] = useState([
    { type: "RELATIVE", longAssets: ["JPM", "GS"], shortAssets: ["T", "VZ"], magnitude: 30, confidence: 0.6 },
    { type: "ABSOLUTE", longAssets: ["F"], shortAssets: [], magnitude: 80, confidence: 0.4 },
  ]);
  const [params, setParams] = useState({ delta: 2.5, tau: 0.025, maxIssuerWeight: 8, minPositionSize: 0.2 });
  const [hasRun, setHasRun] = useState(false);
  const [showParams, setShowParams] = useState(false);

  const covMatrix = useMemo(() => generateCovarianceMatrix(bonds), [bonds]);

  const results = useMemo(() => {
    if (!hasRun) return null;
    const { wMkt, pi } = computeEquilibrium(bonds, covMatrix, params.delta);
    const viewData = buildViewMatrices(views, bonds, covMatrix, params.tau);
    const { muBL, sigmaBL } = computePosterior(pi, covMatrix, params.tau, viewData);
    const w = optimisePortfolio(muBL, sigmaBL, params.delta, bonds, params);
    const risk = computeRiskMetrics(w, bonds, covMatrix, muBL);
    return { wMkt, pi, muBL, sigmaBL, w, risk };
  }, [hasRun, bonds, covMatrix, views, params]);

  const addView = () => setViews([...views, { type: "ABSOLUTE", longAssets: [bonds[0].id], shortAssets: [], magnitude: 50, confidence: 0.5 }]);
  const removeView = (i) => setViews(views.filter((_, j) => j !== i));
  const updateView = (i, field, val) => { const v = [...views]; v[i] = { ...v[i], [field]: val }; setViews(v); };

  const runOptimisation = useCallback(() => setHasRun(true), []);

  // ───── Universe Tab ─────
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

  // ───── Views Tab ─────
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

  // ───── Results Tab ─────
  const ResultsPanel = () => {
    if (!results) return (
      <div className="text-center py-20 text-gray-400">
        <BarChart3 size={48} className="mx-auto mb-3 opacity-40" />
        <p className="text-lg font-medium">No results yet</p>
        <p className="text-sm mt-1">Configure views and click "Run Optimisation"</p>
      </div>
    );

    const { w, risk, muBL, pi, wMkt } = results;

    // Chart data
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
          <MetricCard label="Expected Loss" value={risk.el.toFixed(1)} unit="bp" sub="PD × LGD weighted" color="red" />
          <MetricCard label="Spread Duration" value={risk.portSpreadDur.toFixed(2)} unit="yr" sub="Portfolio level" color="blue" />
          <MetricCard label="Credit VaR (99%)" value={risk.creditVaR.toFixed(0)} unit="bp" sub="Parametric 1-year" color="red" />
        </div>

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
              <Bar dataKey="equilibrium" fill="#cbd5e1" name="Equilibrium (π)" radius={[0, 2, 2, 0]} />
              <Bar dataKey="posterior" fill="#3b82f6" name="Posterior (μ_BL)" radius={[0, 2, 2, 0]} />
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
              <button onClick={() => setShowParams(!showParams)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                <Settings size={15} />{showParams ? "Hide" : "Parameters"}{showParams ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button onClick={() => { setHasRun(false); setTimeout(runOptimisation, 50); }}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 shadow-md transition-all active:scale-95">
                <Play size={15} /> Run Optimisation
              </button>
            </div>
          </div>

          {/* Parameters Panel */}
          {showParams && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Risk Aversion (δ)</label>
                <input type="number" step="0.1" value={params.delta} onChange={e => setParams({ ...params, delta: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prior Uncertainty (τ)</label>
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
        Black-Litterman Credit Optimiser v1.0 &middot; Implements Bayesian posterior blending with credit-specific risk framework
      </div>
    </div>
  );
}
