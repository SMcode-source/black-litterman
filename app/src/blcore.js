/**
 * Unified Black-Litterman engine.
 *
 * Asset-class agnostic: it takes a covariance matrix, benchmark weights and a
 * set of views, and returns posterior returns plus optimal weights. Equities
 * and credit both feed the same code path.
 *
 * Scaling note -- this is written to handle N = 500+ in the browser. The naive
 * formulation inverts Sigma (N x N), which is O(N^3) and would lock the tab at
 * 500 names. Two choices avoid that entirely:
 *
 *   1. The posterior uses the view-space form
 *          mu_BL = pi + tauSigma P' (P tauSigma P' + Omega)^-1 (Q - P pi)
 *      whose only inverse is K x K, where K is the number of views (typically
 *      2-3). No N x N inverse ever appears.
 *
 *   2. The posterior covariance is kept as an *operator* rather than a matrix.
 *      Sigma_post is Sigma plus a rank-K correction, so a matrix-vector product
 *      costs O(N^2 + K N). The optimiser only ever needs those products, so we
 *      never allocate or form an N x N posterior.
 *
 * Covariance is a flat Float64Array in row-major order: cov[i * n + j].
 */

// ---------------------------------------------------------------------------
// Dense linear algebra primitives (flat arrays)
// ---------------------------------------------------------------------------

/**
 * y = M v  for a flat n x n symmetric matrix. O(n^2).
 *
 * Pass `out` to write into an existing buffer. The solver runs this hundreds of
 * times, and at n = 485 a fresh 4 KB allocation per call put more time into GC
 * than into arithmetic.
 */
export function matVec(M, v, n, out = null) {
  const y = out || new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += M[row + j] * v[j];
    y[i] = s;
  }
  return y;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Solve A x = b for a small dense K x K system (Gaussian elimination with
 * partial pivoting). K is the view count, so this is always tiny.
 * Returns null if the system is singular.
 */
export function solveDense(A, b, k) {
  const M = new Float64Array(k * (k + 1));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) M[i * (k + 1) + j] = A[i * k + j];
    M[i * (k + 1) + k] = b[i];
  }
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(M[r * (k + 1) + col]) > Math.abs(M[piv * (k + 1) + col])) piv = r;
    }
    if (Math.abs(M[piv * (k + 1) + col]) < 1e-14) return null;
    if (piv !== col) {
      for (let j = col; j <= k; j++) {
        const t = M[col * (k + 1) + j];
        M[col * (k + 1) + j] = M[piv * (k + 1) + j];
        M[piv * (k + 1) + j] = t;
      }
    }
    const d = M[col * (k + 1) + col];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r * (k + 1) + col] / d;
      if (f === 0) continue;
      for (let j = col; j <= k; j++) M[r * (k + 1) + j] -= f * M[col * (k + 1) + j];
    }
  }
  const x = new Float64Array(k);
  for (let i = 0; i < k; i++) x[i] = M[i * (k + 1) + k] / M[i * (k + 1) + i];
  return x;
}

// ---------------------------------------------------------------------------
// Step 1: Equilibrium (reverse optimisation)   pi = delta * Sigma * w_bmk
// ---------------------------------------------------------------------------

export function equilibriumReturns(cov, wBmk, delta, n) {
  const sw = matVec(cov, wBmk, n);
  const pi = new Float64Array(n);
  for (let i = 0; i < n; i++) pi[i] = delta * sw[i];
  return pi;
}

// ---------------------------------------------------------------------------
// Step 2: Views -> sparse P rows, Q, Omega
// ---------------------------------------------------------------------------

/**
 * Translate views into BL matrices. P rows are kept sparse ({idx, val}) because
 * a view touches one or two assets out of N, so a dense K x N would be almost
 * entirely zeros.
 *
 * view = { type: "absolute"|"relative", asset, vsAsset, value, confidence }
 * `value` is an annualised return (decimal). `confidence` is in (0, 1).
 */
export function buildViews(views, indexOf, cov, tau, n) {
  const rows = [];
  for (const v of views) {
    const i = indexOf(v.asset);
    if (i == null || i < 0) continue;

    let idx, val;
    if (v.type === "relative") {
      const j = indexOf(v.vsAsset);
      if (j == null || j < 0 || j === i) continue;
      idx = [i, j];
      val = [1, -1];
    } else {
      idx = [i];
      val = [1];
    }

    // View variance p' Sigma p, needed for the He-Litterman Omega.
    let pSp = 0;
    for (let a = 0; a < idx.length; a++) {
      for (let b = 0; b < idx.length; b++) {
        pSp += val[a] * val[b] * cov[idx[a] * n + idx[b]];
      }
    }

    // Omega_kk = tau * (p' Sigma p) * (1/c - 1): confidence -> 1 means Omega -> 0
    // (view dominates); confidence -> 0 means Omega -> inf (view ignored).
    const c = Math.min(Math.max(v.confidence ?? 0.5, 0.01), 0.99);
    const omega = Math.max(tau * pSp * (1 / c - 1), 1e-12);

    rows.push({ idx, val, q: v.value, omega });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Step 3: Posterior returns and posterior covariance operator
// ---------------------------------------------------------------------------

/**
 * Blend the prior with the views.
 *
 * Returns muBL (Float64Array) and sigmaOp, an operator exposing mul(v) for the
 * posterior covariance. sigmaOp is never materialised as a matrix.
 */
export function posterior(cov, pi, viewRows, tau, n) {
  const sigmaMul = (v, out) => matVec(cov, v, n, out);

  if (!viewRows.length) {
    // No views: posterior collapses to the prior, Sigma_post = (1 + tau) Sigma.
    return {
      muBL: Float64Array.from(pi),
      sigmaOp: { mul: (v, out) => { const s = sigmaMul(v, out); for (let i = 0; i < n; i++) s[i] *= 1 + tau; return s; } },
      viewImpact: [],
    };
  }

  const K = viewRows.length;

  // tsp_k = tau * Sigma * p_k  (one O(n^2) product per view)
  const tsp = viewRows.map((r) => {
    const p = new Float64Array(n);
    for (let a = 0; a < r.idx.length; a++) p[r.idx[a]] = r.val[a];
    const s = sigmaMul(p);
    for (let i = 0; i < n; i++) s[i] *= tau;
    return s;
  });

  // M = P tauSigma P' + Omega   (K x K)
  const M = new Float64Array(K * K);
  for (let k = 0; k < K; k++) {
    for (let l = 0; l < K; l++) {
      let s = 0;
      const r = viewRows[k];
      for (let a = 0; a < r.idx.length; a++) s += r.val[a] * tsp[l][r.idx[a]];
      M[k * K + l] = s;
    }
    M[k * K + k] += viewRows[k].omega;
  }

  // rhs = Q - P pi
  const rhs = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const r = viewRows[k];
    let pPi = 0;
    for (let a = 0; a < r.idx.length; a++) pPi += r.val[a] * pi[r.idx[a]];
    rhs[k] = r.q - pPi;
  }

  const y = solveDense(M, rhs, K);
  if (!y) {
    return {
      muBL: Float64Array.from(pi),
      sigmaOp: { mul: (v, out) => { const s = sigmaMul(v, out); for (let i = 0; i < n; i++) s[i] *= 1 + tau; return s; } },
      viewImpact: viewRows.map(() => 0),
      singular: true,
    };
  }

  // mu_BL = pi + sum_k y_k tsp_k
  const muBL = Float64Array.from(pi);
  for (let k = 0; k < K; k++) {
    const yk = y[k];
    const t = tsp[k];
    for (let i = 0; i < n; i++) muBL[i] += yk * t[i];
  }

  // Sigma_post v = (1 + tau) Sigma v - sum_k (M^-1 P tauSigma v)_k tsp_k
  const sigmaOp = {
    mul: (v, out) => {
      const base = sigmaMul(v, out);
      for (let i = 0; i < n; i++) base[i] *= 1 + tau;
      const z = new Float64Array(K);
      for (let k = 0; k < K; k++) z[k] = dot(tsp[k], v);
      const yv = solveDense(M, z, K);
      if (yv) {
        for (let k = 0; k < K; k++) {
          const c = yv[k];
          const t = tsp[k];
          for (let i = 0; i < n; i++) base[i] -= c * t[i];
        }
      }
      return base;
    },
  };

  // How far each view moved its own combination, in bp -- useful in the UI.
  const viewImpact = viewRows.map((r) => {
    let before = 0, after = 0;
    for (let a = 0; a < r.idx.length; a++) {
      before += r.val[a] * pi[r.idx[a]];
      after += r.val[a] * muBL[r.idx[a]];
    }
    return { before, after, target: r.q };
  });

  return { muBL, sigmaOp, viewImpact };
}

// ---------------------------------------------------------------------------
// Step 4: Constrained optimisation (gradient projection)
// ---------------------------------------------------------------------------

/**
 * Euclidean projection onto { w : sum(w) = 1, lo <= w_i <= hi }.
 *
 * sum(clip(v - theta, lo, hi)) is non-increasing in theta, so bisect on theta.
 */
export function projectToSimplexBox(v, lo, hi, n, outBuf = null) {
  const sumAt = (theta) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const x = v[i] - theta;
      s += x < lo ? lo : x > hi ? hi : x;
    }
    return s;
  };

  // Infeasible box: fall back to the closest uniform-ish point.
  if (lo * n > 1 + 1e-12 || hi * n < 1 - 1e-12) {
    const bad = outBuf || new Float64Array(n);
    bad.fill(Math.min(Math.max(1 / n, lo), hi));
    return bad;
  }

  let a = -1, b = 1;
  while (sumAt(a) < 1) a *= 2;
  while (sumAt(b) > 1) b *= 2;
  for (let it = 0; it < 100; it++) {
    const m = (a + b) / 2;
    if (sumAt(m) > 1) a = m; else b = m;
    if (b - a < 1e-14) break;
  }
  const theta = (a + b) / 2;
  const out = outBuf || new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = v[i] - theta;
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
  return out;
}

/** Largest eigenvalue estimate via power iteration -- sets a safe step size. */
function spectralNorm(op, n, iters = 24) {
  let v = new Float64Array(n).fill(1 / Math.sqrt(n));
  let buf = new Float64Array(n);
  let lambda = 1;
  for (let it = 0; it < iters; it++) {
    const w = op.mul(v, buf);
    const norm = Math.sqrt(dot(w, w));
    if (!isFinite(norm) || norm < 1e-18) break;
    for (let i = 0; i < n; i++) w[i] /= norm;
    lambda = norm;
    buf = v;   // recycle the old iterate as the next scratch buffer
    v = w;
  }
  return lambda;
}

/**
 * Maximise  mu'w - (delta/2) w' Sigma w   s.t. sum(w) = 1, lo <= w <= hi.
 *
 * Projected gradient ascent. Each iteration is one O(n^2) matrix-vector product,
 * so 500 names cost ~250k multiply-adds per step -- a few hundred steps runs in
 * well under a second.
 */
export function optimise({ mu, sigmaOp, delta, n, lo = 0, hi = 1, w0 = null, iters = 2000, tol = 1e-13 }) {
  // Spectral projected gradient (Barzilai-Borwein steps).
  //
  // A fixed 1/L step is far too conservative here: equity covariances are badly
  // conditioned (annualised vols run from ~15% to ~70%), and both plain and
  // Nesterov-accelerated gradient needed 1500-3000 iterations -- seconds of
  // blocked UI. BB steps infer local curvature from the previous step and
  // converge in a couple of hundred iterations on the same problem, at one
  // matrix-vector product each.
  const L = Math.max(delta * spectralNorm(sigmaOp, n), 1e-8);
  let alpha = 1 / L;

  // Every buffer the loop needs, allocated once up front.
  let w = new Float64Array(n);
  let next = new Float64Array(n);
  let g = new Float64Array(n);
  let gNext = new Float64Array(n);
  const cand = new Float64Array(n);
  const scratch = new Float64Array(n);

  w.set(w0 ? w0 : new Float64Array(n).fill(1 / n));
  projectToSimplexBox(Float64Array.from(w), lo, hi, n, w);

  // Gradient of the minimised objective f(w) = (delta/2) w'Sigma w - mu'w
  const gradInto = (x, out) => {
    const sx = sigmaOp.mul(x, scratch);
    for (let i = 0; i < n; i++) out[i] = delta * sx[i] - mu[i];
    return out;
  };

  gradInto(w, g);
  let itersRun = 0;

  for (let it = 0; it < iters; it++) {
    itersRun = it + 1;

    for (let i = 0; i < n; i++) cand[i] = w[i] - alpha * g[i];
    projectToSimplexBox(cand, lo, hi, n, next);

    let shift = 0;
    for (let i = 0; i < n; i++) shift += Math.abs(next[i] - w[i]);
    if (shift < tol) { const t = w; w = next; next = t; break; }

    gradInto(next, gNext);

    // BB1 step: alpha = (s's)/(s'y), with s = w+ - w and y = g+ - g.
    let ss = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const sd = next[i] - w[i];
      const yd = gNext[i] - g[i];
      ss += sd * sd;
      sy += sd * yd;
    }
    // sy <= 0 means no usable curvature information; fall back to the safe step.
    alpha = sy > 1e-300 ? ss / sy : 1 / L;
    if (!isFinite(alpha) || alpha <= 0) alpha = 1 / L;
    alpha = Math.min(Math.max(alpha, 1e-12 / L), 1e6 / L);

    const tw = w; w = next; next = tw;      // swap, no allocation
    const tg = g; g = gNext; gNext = tg;
  }
  return { w, iters: itersRun, status: "spectral_projected_gradient" };
}

// ---------------------------------------------------------------------------
// Step 5: Risk and attribution
// ---------------------------------------------------------------------------

export function portfolioStats({ w, wBmk, mu, cov, sigmaOp, n, riskFree = 0 }) {
  const sw = matVec(cov, w, n);
  const variance = dot(w, sw);
  const vol = Math.sqrt(Math.max(variance, 0));
  const ret = dot(mu, w);

  const active = new Float64Array(n);
  for (let i = 0; i < n; i++) active[i] = w[i] - wBmk[i];
  const te = Math.sqrt(Math.max(dot(active, matVec(cov, active, n)), 0));

  const bmkRet = dot(mu, wBmk);
  const bmkVol = Math.sqrt(Math.max(dot(wBmk, matVec(cov, wBmk, n)), 0));

  return {
    ret,
    vol,
    variance,
    sharpe: vol > 0 ? (ret - riskFree) / vol : 0,
    te,
    ir: te > 0 ? (ret - bmkRet) / te : 0,
    bmkRet,
    bmkVol,
    bmkSharpe: bmkVol > 0 ? (bmkRet - riskFree) / bmkVol : 0,
    active,
    // Parametric 99% one-tail loss quantile.
    var99: ret - 2.326 * vol,
    posteriorVol: sigmaOp ? Math.sqrt(Math.max(dot(w, sigmaOp.mul(w)), 0)) : null,
  };
}

/** Aggregate weights by a categorical key (sector, rating, ...). */
export function groupWeights(items, w, wBmk, key) {
  const out = new Map();
  items.forEach((it, i) => {
    const g = it[key] ?? "Unknown";
    const cur = out.get(g) || { group: g, optimal: 0, benchmark: 0 };
    cur.optimal += w[i];
    cur.benchmark += wBmk[i];
    out.set(g, cur);
  });
  return [...out.values()].sort((a, b) => b.optimal - a.optimal);
}
