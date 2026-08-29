/**
 * Browser-side Black-Litterman Engine
 * ====================================
 * JavaScript fallback when the Python backend is unavailable.
 * Implements the same 4-step BL pipeline as the backend:
 *
 *   1. generateCovarianceMatrix  – Simplified sector/rating correlation model
 *   2. computeEquilibrium        – Implied returns from market weights
 *   3. buildViewMatrices         – P, Q, Omega from manager views
 *      computePosterior          – Bayesian blend of prior + views
 *   4. optimisePortfolio         – Gradient projection (no cvxpy in browser)
 *      computeRiskMetrics        – Portfolio-level analytics
 */
import * as math from "mathjs";
import { SECTORS, RATING_ORDER } from "./constants";


// ---------------------------------------------------------------------------
// Helper: matrix inverse with regularisation fallback
// ---------------------------------------------------------------------------
function matInverse(m) {
  try {
    return math.inv(m);
  } catch {
    // Add small diagonal for numerical stability
    const reg = m.map((row, i) => row.map((v, j) => v + (i === j ? 1e-6 : 0)));
    return math.inv(reg);
  }
}


// ---------------------------------------------------------------------------
// Step 1: Covariance matrix  (simplified sector/rating model)
// ---------------------------------------------------------------------------
/**
 * Build an N x N covariance matrix using a simple correlation model:
 *   - Base correlation: 0.15 (different sector)
 *   - Same sector: 0.55
 *   - Rating proximity bonus: up to +0.15
 *   - Volatility: OAS * spread_duration * 0.30
 */
export function generateCovarianceMatrix(bonds) {
  const n = bonds.length;
  const cov = math.zeros(n, n)._data;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const bi = bonds[i], bj = bonds[j];

      // Per-bond spread return vol
      const volI = (bi.oas / 10000) * bi.spreadDur * 0.3;
      const volJ = (bj.oas / 10000) * bj.spreadDur * 0.3;

      // Correlation: sector match + rating proximity
      let corr = bi.sector === bj.sector ? 0.55 : 0.15;
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


// ---------------------------------------------------------------------------
// Step 2: Equilibrium returns   pi = delta * Sigma * w_mkt
// ---------------------------------------------------------------------------
export function computeEquilibrium(bonds, covMatrix, delta) {
  const totalMV = bonds.reduce((s, b) => s + b.mktValue, 0);
  const wMkt = bonds.map(b => b.mktValue / totalMV);
  const pi = math.multiply(math.multiply(delta, covMatrix), wMkt);
  return { wMkt, pi };
}


// ---------------------------------------------------------------------------
// Step 3a: View matrices  (P, Q, Omega)
// ---------------------------------------------------------------------------
/**
 * Translate manager views into BL matrices.
 * Returns { P, Q, omega } or null if no views.
 */
export function buildViewMatrices(views, bonds, covMatrix, tau) {
  if (!views.length) return null;

  const n = bonds.length;
  const k = views.length;
  const P = math.zeros(k, n)._data;
  const Q = [];

  views.forEach((v, vi) => {
    Q.push(v.magnitude / 10000);

    if (v.type === "ABSOLUTE") {
      // Single bond absolute view
      const idx = bonds.findIndex(b => b.id === v.longAssets[0]);
      if (idx >= 0) P[vi][idx] = 1;
    } else {
      // Relative view: longs vs shorts
      const longs = v.longAssets.filter(a => bonds.some(b => b.id === a));
      const shorts = v.shortAssets.filter(a => bonds.some(b => b.id === a));
      longs.forEach(a => {
        const idx = bonds.findIndex(b => b.id === a);
        if (idx >= 0) P[vi][idx] = 1 / longs.length;
      });
      shorts.forEach(a => {
        const idx = bonds.findIndex(b => b.id === a);
        if (idx >= 0) P[vi][idx] = -1 / shorts.length;
      });
    }
  });

  // Omega: view uncertainty (Idzorek confidence method)
  const omega = math.zeros(k, k)._data;
  for (let i = 0; i < k; i++) {
    const pRow = P[i];
    const viewVar = math.multiply(math.multiply(pRow, covMatrix), pRow);
    const conf = views[i].confidence || 0.5;
    omega[i][i] = tau * viewVar * (1 / conf - 1);
    if (omega[i][i] < 1e-12) omega[i][i] = 1e-12;
  }

  return { P, Q, omega };
}


// ---------------------------------------------------------------------------
// Step 3b: Posterior   mu_BL = blend(equilibrium, views)
// ---------------------------------------------------------------------------
/**
 * Bayesian posterior:
 *   mu_BL = [(tau*Sigma)^-1 + P'*Omega^-1*P]^-1
 *           * [(tau*Sigma)^-1 * pi  +  P'*Omega^-1 * Q]
 */
export function computePosterior(pi, covMatrix, tau, viewData) {
  const tauSigma = math.multiply(tau, covMatrix);
  const tauSigmaInv = matInverse(tauSigma);

  // No views → return equilibrium directly
  if (!viewData) {
    return { muBL: Array.from(pi), sigmaBL: math.add(covMatrix, tauSigma) };
  }

  const { P, Q, omega } = viewData;
  const omegaInv = matInverse(omega);
  const Pt = math.transpose(P);

  // Posterior precision and covariance
  const posteriorPrecision = math.add(tauSigmaInv, math.multiply(math.multiply(Pt, omegaInv), P));
  const posteriorCov = matInverse(posteriorPrecision);

  // Posterior mean
  const term1 = math.multiply(tauSigmaInv, pi);
  const term2 = math.multiply(math.multiply(Pt, omegaInv), Q);
  const muBL = math.multiply(posteriorCov, math.add(term1, term2));

  const sigmaBL = math.add(covMatrix, posteriorCov);
  return { muBL: Array.isArray(muBL) ? muBL : muBL._data || [muBL], sigmaBL };
}


// ---------------------------------------------------------------------------
// Step 4a: Portfolio optimisation  (gradient projection, no cvxpy)
// ---------------------------------------------------------------------------
/**
 * Solve:  max  w'mu - (delta/2) w'Sigma*w
 * Subject to: long-only, sum=1, position limits
 *
 * Uses projected gradient ascent (5000 iterations).
 */
export function optimisePortfolio(muBL, sigmaBL, delta, bonds, constraints) {
  const n = bonds.length;
  let w = muBL.map(() => 1 / n);  // start equal-weight
  const lr = 0.0005;

  for (let iter = 0; iter < 5000; iter++) {
    // Gradient of objective: mu - delta * Sigma * w
    const sigW = math.multiply(sigmaBL, w);
    const grad = math.subtract(muBL, math.multiply(delta, sigW));

    // Gradient step
    w = w.map((wi, i) => wi + lr * grad[i]);

    // Project onto constraints: clip to [minW, maxW], then normalise to sum=1
    const maxW = (constraints.maxIssuerWeight || 5) / 100;
    const minW = (constraints.minPositionSize || 0) / 100;
    w = w.map(wi => Math.max(minW, Math.min(maxW, wi)));
    const sum = w.reduce((a, b) => a + b, 0);
    w = w.map(wi => wi / sum);
  }

  return w;
}


// ---------------------------------------------------------------------------
// Step 4b: Risk metrics
// ---------------------------------------------------------------------------
/**
 * Compute portfolio-level analytics:
 *   - Return, volatility, Sharpe ratio
 *   - Tracking error, information ratio
 *   - Expected loss, DTS, spread duration
 *   - Sector & rating weight decomposition
 *   - Parametric Credit VaR (99%)
 */
export function computeRiskMetrics(w, bonds, covMatrix, muBL) {
  // Portfolio return & risk
  const portReturn = math.dot(w, muBL) * 10000;                    // bp
  const portVar = math.multiply(math.multiply(w, covMatrix), w);
  const portVol = Math.sqrt(portVar) * 10000;                      // bp
  const sharpe = portVol > 0 ? portReturn / portVol : 0;

  // Benchmark weights & active positions
  const totalMV = bonds.reduce((s, b) => s + b.mktValue, 0);
  const wBmk = bonds.map(b => b.mktValue / totalMV);
  const activeW = w.map((wi, i) => wi - wBmk[i]);

  // Tracking error & information ratio
  const te = Math.sqrt(math.multiply(math.multiply(activeW, covMatrix), activeW)) * 10000;
  const ir = te > 0 ? (portReturn - math.dot(wBmk, muBL) * 10000) / te : 0;

  // Credit metrics
  const el = math.dot(w, bonds.map(b => b.pd * b.lgd)) * 10000;   // expected loss (bp)
  const dts = math.dot(w, bonds.map(b => (b.oas / 10000) * b.spreadDur)) * 10000;
  const portSpreadDur = math.dot(w, bonds.map(b => b.spreadDur));

  // Sector weight decomposition
  const sectorWeights = {}, sectorBmkWeights = {};
  bonds.forEach((b, i) => {
    sectorWeights[b.sector] = (sectorWeights[b.sector] || 0) + w[i];
    sectorBmkWeights[b.sector] = (sectorBmkWeights[b.sector] || 0) + wBmk[i];
  });

  // Rating weight decomposition
  const ratingWeights = {}, ratingBmkWeights = {};
  bonds.forEach((b, i) => {
    const bucket = b.rating.startsWith("AAA") ? "AAA"
                 : b.rating.startsWith("AA") ? "AA"
                 : b.rating.startsWith("A") ? "A"
                 : "BBB";
    ratingWeights[bucket] = (ratingWeights[bucket] || 0) + w[i];
    ratingBmkWeights[bucket] = (ratingBmkWeights[bucket] || 0) + wBmk[i];
  });

  // Parametric Credit VaR (99%)
  const creditVaR = portReturn - 2.326 * portVol;

  return {
    portReturn, portVol, sharpe, te, ir, el, dts, portSpreadDur,
    sectorWeights, sectorBmkWeights, ratingWeights, ratingBmkWeights,
    creditVaR, activeW, wBmk,
  };
}
