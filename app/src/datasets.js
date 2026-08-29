/**
 * Dataset adapters.
 *
 * Both asset classes are normalised into one shape so blcore.js never needs to
 * know whether it is looking at equities or bonds:
 *
 *   { key, label, n, items[], cov: Float64Array(n*n), wBmk: Float64Array, meta }
 *
 * Equities come from a Yahoo Finance snapshot built at deploy time (Yahoo sends
 * no CORS headers, so the browser cannot fetch it directly). Credit uses a
 * sample investment-grade universe with a structural covariance.
 */

import { SAMPLE_BONDS, RATING_ORDER } from "./constants.js";

const BASE = import.meta.env.BASE_URL || "/";

// ---------------------------------------------------------------------------
// Equities -- Yahoo Finance snapshot
// ---------------------------------------------------------------------------

let equityCache = null;

export async function loadEquityDataset() {
  if (equityCache) return equityCache;

  const [uniRes, covRes] = await Promise.all([
    fetch(`${BASE}data/equity_universe.json`),
    fetch(`${BASE}data/equity_cov.f32`),
  ]);
  if (!uniRes.ok) throw new Error(`universe fetch failed (${uniRes.status})`);
  if (!covRes.ok) throw new Error(`covariance fetch failed (${covRes.status})`);

  const { meta, universe } = await uniRes.json();
  const buf = await covRes.arrayBuffer();
  const n = universe.length;

  const expected = n * n * 4;
  if (buf.byteLength !== expected) {
    throw new Error(`covariance size mismatch: got ${buf.byteLength}, expected ${expected}`);
  }

  // Keep the covariance in float32. The solver's matrix-vector product is
  // memory-bandwidth bound, not compute bound: at n = 485 a float64 matrix is
  // 1.88 MB and misses cache on every pass, while float32 is 940 KB and runs
  // roughly twice as fast. JS accumulates in double regardless, and the data
  // arrived as float32 on the wire, so no precision is actually lost.
  const cov = new Float32Array(buf);

  const wBmk = new Float64Array(n);
  universe.forEach((u, i) => { wBmk[i] = u.weight; });

  equityCache = {
    key: "equity",
    label: "S&P 500 Equities",
    n,
    items: universe.map((u) => ({
      id: u.ticker,
      name: u.name,
      sector: u.sector,
      marketCap: u.marketCap,
      meanReturn: u.meanReturn,
      vol: u.vol,
    })),
    cov,
    wBmk,
    meta,
  };
  return equityCache;
}

// ---------------------------------------------------------------------------
// Credit -- sample IG universe with a structural covariance
// ---------------------------------------------------------------------------

/**
 * Spread-return covariance. Vol scales with OAS x spread duration; correlation
 * comes from sector match plus rating proximity.
 */
function creditCovariance(bonds) {
  const n = bonds.length;
  const cov = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const bi = bonds[i], bj = bonds[j];
      const volI = (bi.oas / 10000) * bi.spreadDur * 0.3;
      const volJ = (bj.oas / 10000) * bj.spreadDur * 0.3;

      let corr;
      if (i === j) {
        corr = 1;
      } else {
        corr = bi.sector === bj.sector ? 0.55 : 0.15;
        const dist = Math.abs(RATING_ORDER.indexOf(bi.rating) - RATING_ORDER.indexOf(bj.rating));
        corr = Math.min(corr + Math.max(0, 0.15 - dist * 0.03), 0.95);
      }
      const v = volI * volJ * corr;
      cov[i * n + j] = v;
      cov[j * n + i] = v;
    }
  }
  return cov;
}

export function loadCreditDataset() {
  const bonds = SAMPLE_BONDS;
  const n = bonds.length;
  const total = bonds.reduce((s, b) => s + b.mktValue, 0);

  const wBmk = new Float64Array(n);
  bonds.forEach((b, i) => { wBmk[i] = b.mktValue / total; });

  return {
    key: "credit",
    label: "IG Corporate Credit",
    n,
    items: bonds.map((b) => ({
      id: b.id,
      name: b.issuer,
      sector: b.sector,
      rating: b.rating,
      ratingBucket: b.rating.startsWith("AAA") ? "AAA"
                  : b.rating.startsWith("AA") ? "AA"
                  : b.rating.startsWith("A") ? "A" : "BBB",
      oas: b.oas,
      spreadDur: b.spreadDur,
      pd: b.pd,
      lgd: b.lgd,
      mktValue: b.mktValue,
    })),
    cov: creditCovariance(bonds),
    wBmk,
    meta: {
      asOf: "sample universe",
      source: "Bundled IG sample (bond analytics are not available from Yahoo)",
      count: n,
    },
  };
}

// ---------------------------------------------------------------------------
// Subsetting -- the browser optimises only the names you select
// ---------------------------------------------------------------------------

/** Slice a dataset down to `indices`, renormalising benchmark weights to 1. */
export function subsetDataset(ds, indices) {
  const m = indices.length;
  if (m === ds.n && indices.every((v, i) => v === i)) return ds;

  const cov = new (ds.cov.constructor)(m * m);
  for (let a = 0; a < m; a++) {
    const ia = indices[a] * ds.n;
    for (let b = 0; b < m; b++) cov[a * m + b] = ds.cov[ia + indices[b]];
  }

  const wRaw = indices.map((i) => ds.wBmk[i]);
  const total = wRaw.reduce((s, x) => s + x, 0) || 1;
  const wBmk = new Float64Array(m);
  for (let a = 0; a < m; a++) wBmk[a] = wRaw[a] / total;

  return {
    ...ds,
    n: m,
    items: indices.map((i) => ds.items[i]),
    cov,
    wBmk,
    subsetOf: ds.n,
  };
}

/** Credit-specific analytics that have no equity equivalent. */
export function creditRiskExtras(items, w, wBmk) {
  let el = 0, dts = 0, spreadDur = 0, elBmk = 0;
  items.forEach((b, i) => {
    el += w[i] * b.pd * b.lgd;
    elBmk += wBmk[i] * b.pd * b.lgd;
    dts += w[i] * (b.oas / 10000) * b.spreadDur;
    spreadDur += w[i] * b.spreadDur;
  });
  return {
    expectedLoss: el * 10000,
    expectedLossBmk: elBmk * 10000,
    dts: dts * 10000,
    spreadDur,
  };
}
