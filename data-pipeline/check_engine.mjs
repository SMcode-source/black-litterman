/**
 * Engine sanity checks against the real S&P 500 snapshot.
 *
 *   node data-pipeline/check_engine.mjs
 *
 * The load-bearing check is #1: with no views the posterior equals the prior,
 * so the optimiser must reproduce the benchmark almost exactly. If tracking
 * error is not ~0 there, the solver has not converged and every downstream
 * number is quietly wrong.
 */
import { readFileSync } from "node:fs";
import {
  equilibriumReturns, buildViews, posterior, optimise,
  portfolioStats, matVec, dot,
} from "../app/src/blcore.js";

const DATA = "app/public/data";
const { meta, universe } = JSON.parse(readFileSync(`${DATA}/equity_universe.json`, "utf8"));
const raw = readFileSync(`${DATA}/equity_cov.f32`);
const f32 = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

const n = universe.length;
// float32 exactly as the app ships it -- the solver is memory-bandwidth bound.
const cov = f32;
const wBmk = new Float64Array(n);
universe.forEach((u, i) => { wBmk[i] = u.weight; });

const idx = new Map(universe.map((u, i) => [u.ticker, i]));
const indexOf = (t) => (idx.has(t) ? idx.get(t) : -1);

const delta = 2.5, tau = 0.05, lo = 0, hi = 0.10;
const pct = (x) => (x * 100).toFixed(3) + "%";

console.log(`Universe: ${n} names, as of ${meta.asOf}, ${meta.observations} observations\n`);

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " -- " + detail : ""}`);
  if (!pass) failures++;
};

// --- covariance well-formedness -------------------------------------------
console.log("Covariance matrix");
let asym = 0, negVar = 0;
for (let i = 0; i < n; i++) {
  if (cov[i * n + i] <= 0) negVar++;
  for (let j = i + 1; j < n; j++) {
    asym = Math.max(asym, Math.abs(cov[i * n + j] - cov[j * n + i]));
  }
}
check("symmetric", asym < 1e-9, `max asymmetry ${asym.toExponential(2)}`);
check("positive variances", negVar === 0, `${negVar} non-positive diagonal entries`);

// Positive semi-definite in the directions that matter: random quadratic forms.
let minQuad = Infinity;
for (let trial = 0; trial < 200; trial++) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.random() - 0.5;
  const q = dot(v, matVec(cov, v, n)) / dot(v, v);
  minQuad = Math.min(minQuad, q);
}
check("PSD on random directions", minQuad > -1e-10, `min Rayleigh quotient ${minQuad.toExponential(2)}`);

// --- 1. reverse-optimisation round trip ------------------------------------
// With no views and tau -> 0, Sigma_post -> Sigma and the stationarity
// condition is  pi = delta Sigma w + lambda 1. Since pi was *built* as
// delta Sigma w_bmk and w_bmk already sums to 1, lambda = 0 and the optimiser
// must return the benchmark exactly. This is the real invariant.
//
// With tau > 0 the optimum is NOT the benchmark: w_bmk/(1+tau) sums to only
// 1/(1+tau), so the residual tau/(1+tau) of weight is redistributed along the
// minimum-variance direction Sigma^-1 1. A non-zero tracking error there is
// correct behaviour, not a convergence failure.
console.log("\n1. Reverse-optimisation round trip (no views, tau -> 0)");
const pi = equilibriumReturns(cov, wBmk, delta, n);
const pTiny = posterior(cov, pi, [], 1e-9, n);
const t0 = Date.now();
const r0 = optimise({ mu: pTiny.muBL, sigmaOp: pTiny.sigmaOp, delta, n, lo, hi, w0: wBmk, iters: 4000 });
const ms0 = Date.now() - t0;
const s0 = portfolioStats({ w: r0.w, wBmk, mu: pTiny.muBL, cov, sigmaOp: pTiny.sigmaOp, n });

let sum0 = 0, maxDev = 0, held0 = 0;
for (let i = 0; i < n; i++) {
  sum0 += r0.w[i];
  maxDev = Math.max(maxDev, Math.abs(r0.w[i] - wBmk[i]));
  if (r0.w[i] > 1e-6) held0++;
}
console.log(`     solved in ${ms0} ms, ${r0.iters} iterations, ${held0}/${n} names held`);
check("weights sum to 1", Math.abs(sum0 - 1) < 1e-8, `sum = ${sum0.toFixed(12)}`);
check("weights within box", r0.w.every((x) => x >= lo - 1e-9 && x <= hi + 1e-9));
check("recovers the benchmark", maxDev < 1e-3, `max |w - w_bmk| = ${pct(maxDev)}`);
check("tracking error ~ 0", s0.te < 1e-3, `TE = ${pct(s0.te)}`);

// --- 1b. convergence: the answer must be stable in the iteration budget ----
console.log("\n1b. Convergence (tau = 0.05, budget vs 10x budget)");
const p0 = posterior(cov, pi, [], tau, n);
// `short` uses the shipped default budget -- that is the thing under test.
const short = optimise({ mu: p0.muBL, sigmaOp: p0.sigmaOp, delta, n, lo, hi, w0: wBmk });
const long = optimise({ mu: p0.muBL, sigmaOp: p0.sigmaOp, delta, n, lo, hi, w0: wBmk, iters: 20000 });
console.log(`     default budget ran ${short.iters} iterations`);
let drift = 0;
for (let i = 0; i < n; i++) drift = Math.max(drift, Math.abs(short.w[i] - long.w[i]));
const sShort = portfolioStats({ w: short.w, wBmk, mu: p0.muBL, cov, sigmaOp: p0.sigmaOp, n });
console.log(`     default budget TE = ${pct(sShort.te)} (tau-driven min-variance tilt, expected > 0)`);
check("stable under 10x iterations", drift < 1e-4, `max weight drift = ${pct(drift)}`);

// --- 2. absolute view moves the right name --------------------------------
console.log("\n2. Absolute view: NVDA returns 40%");
const v1 = buildViews(
  [{ type: "absolute", asset: "NVDA", value: 0.40, confidence: 0.7 }],
  indexOf, cov, tau, n
);
const p1 = posterior(cov, pi, v1, tau, n);
const iNV = indexOf("NVDA");
const r1 = optimise({ mu: p1.muBL, sigmaOp: p1.sigmaOp, delta, n, lo, hi, w0: wBmk });
check("view target exists", iNV >= 0);
check("posterior raised above prior", p1.muBL[iNV] > pi[iNV],
      `${pct(pi[iNV])} -> ${pct(p1.muBL[iNV])}`);
check("posterior sits between prior and view", p1.muBL[iNV] < 0.40);
check("optimiser overweights it", r1.w[iNV] > wBmk[iNV],
      `bmk ${pct(wBmk[iNV])} -> opt ${pct(r1.w[iNV])}`);

// --- 3. confidence monotonicity -------------------------------------------
console.log("\n3. Higher confidence pulls the posterior further");
const post = (c) => {
  const vs = buildViews([{ type: "absolute", asset: "NVDA", value: 0.40, confidence: c }],
                        indexOf, cov, tau, n);
  return posterior(cov, pi, vs, tau, n).muBL[iNV];
};
const lowC = post(0.1), midC = post(0.5), highC = post(0.9);
check("monotone in confidence", lowC < midC && midC < highC,
      `${pct(lowC)} < ${pct(midC)} < ${pct(highC)}`);

// --- 4. relative view -----------------------------------------------------
console.log("\n4. Relative view: AAPL beats MSFT by 10%");
const v4 = buildViews(
  [{ type: "relative", asset: "AAPL", vsAsset: "MSFT", value: 0.10, confidence: 0.6 }],
  indexOf, cov, tau, n
);
const p4 = posterior(cov, pi, v4, tau, n);
const iA = indexOf("AAPL"), iM = indexOf("MSFT");
const spreadPrior = pi[iA] - pi[iM];
const spreadPost = p4.muBL[iA] - p4.muBL[iM];
check("spread widened toward the view", spreadPost > spreadPrior,
      `${pct(spreadPrior)} -> ${pct(spreadPost)} (target 10%)`);
check("did not overshoot the view", spreadPost < 0.10);

// --- 5. max-weight cap is respected under a strong view -------------------
console.log("\n5. Position cap binds under an extreme view");
const v5 = buildViews(
  [{ type: "absolute", asset: "NVDA", value: 3.0, confidence: 0.95 }],
  indexOf, cov, tau, n
);
const p5 = posterior(cov, pi, v5, tau, n);
const r5 = optimise({ mu: p5.muBL, sigmaOp: p5.sigmaOp, delta, n, lo, hi, w0: wBmk });
let sum5 = 0;
for (let i = 0; i < n; i++) sum5 += r5.w[i];
check("cap respected", r5.w[iNV] <= hi + 1e-9, `NVDA weight ${pct(r5.w[iNV])} (cap ${pct(hi)})`);
check("cap actually binds", r5.w[iNV] > hi - 1e-3, "extreme view should push it to the cap");
check("still sums to 1", Math.abs(sum5 - 1) < 1e-8, `sum = ${sum5.toFixed(12)}`);

// --- 6. timing at full universe -------------------------------------------
// Gate on the *best* run, not the mean. A shared CI box or a laptop mid-sync
// can stretch an individual run 3-4x with no code change, and a perf gate that
// flakes the deploy is worse than no gate. The floor still catches the thing
// this is here for: an order-of-magnitude regression -- someone materialising
// Sigma_post, or promoting the covariance back to float64.
console.log("\n6. Performance");
const runs = [];
for (let k = 0; k < 5; k++) {
  const tA = Date.now();
  const p = posterior(cov, pi, v1, tau, n);
  optimise({ mu: p.muBL, sigmaOp: p.sigmaOp, delta, n, lo, hi, w0: wBmk });
  runs.push(Date.now() - tA);
}
const best = Math.min(...runs);
const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
console.log(`     ${n} names, full pipeline: ${best} ms best, ${mean.toFixed(0)} ms mean of ${runs.length}`);
check("full universe solves in seconds, not minutes", best < 5000, `best ${best} ms (runs: ${runs.join(", ")} ms)`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
