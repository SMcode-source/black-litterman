"""
Fetch S&P 500 data from Yahoo Finance and emit a static snapshot for the web app.

Yahoo serves no CORS headers, so the browser cannot call it directly. This script
runs at build time (locally or in GitHub Actions) and writes a snapshot the app
loads as a plain static asset.

Outputs (into --out, default app/public/data):
  equity_universe.json   tickers, names, sectors, market caps, mean returns, vols
  equity_cov.f32         N x N annualised covariance, row-major float32, little-endian

The covariance ships as raw float32 rather than JSON: 500 x 500 is exactly 1 MB
as binary versus roughly 5 MB as text, and the browser reads it straight into a
Float32Array with no parsing.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

TRADING_DAYS = 252


def read_tickers(path, limit=None):
    with open(path) as fh:
        tickers = [line.strip().upper() for line in fh if line.strip()]
    tickers = sorted(set(tickers))
    if limit:
        tickers = tickers[:limit]
    return tickers


def fetch_prices(tickers, start, end, batch_size=100):
    """Download adjusted close prices in batches. Returns a wide DataFrame."""
    frames = []
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i : i + batch_size]
        n = i // batch_size + 1
        total = (len(tickers) - 1) // batch_size + 1
        print(f"  batch {n}/{total} ({len(batch)} tickers)...", flush=True)
        data = yf.download(
            batch,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
            threads=True,
        )
        if data is None or data.empty:
            print(f"    warning: batch {n} returned nothing", file=sys.stderr)
            continue
        close = data["Close"] if isinstance(data.columns, pd.MultiIndex) else data
        if isinstance(close, pd.Series):  # single-ticker batch
            close = close.to_frame(batch[0])
        frames.append(close)

    if not frames:
        raise RuntimeError("no price data returned for any batch")
    return pd.concat(frames, axis=1)


def fetch_market_caps(tickers):
    """Market caps drive the equilibrium weights. Missing names fall back to NaN."""
    caps, names, sectors = {}, {}, {}
    for i, t in enumerate(tickers, 1):
        if i % 50 == 0:
            print(f"  metadata {i}/{len(tickers)}...", flush=True)
        try:
            info = yf.Ticker(t).get_info()
            cap = info.get("marketCap")
            if cap:
                caps[t] = float(cap)
            names[t] = info.get("shortName") or info.get("longName") or t
            sectors[t] = info.get("sector") or "Unknown"
        except Exception as exc:  # noqa: BLE001 - one bad ticker must not kill the run
            print(f"    {t}: {exc}", file=sys.stderr)
    return caps, names, sectors


def build_snapshot(prices, caps, names, sectors, min_coverage=0.9):
    """Clean prices, compute annualised moments, and drop names we cannot use."""
    prices = prices.sort_index()
    prices = prices.loc[:, ~prices.columns.duplicated()]

    # Require a name to have prices for most of the window and a known market cap.
    coverage = prices.notna().mean()
    keep = [
        t
        for t in prices.columns
        if coverage.get(t, 0) >= min_coverage and caps.get(t)
    ]
    keep = sorted(keep)
    if len(keep) < 2:
        raise RuntimeError(f"only {len(keep)} usable tickers after filtering")

    prices = prices[keep].ffill().dropna(how="any")
    returns = np.log(prices / prices.shift(1)).dropna(how="any")

    mu = returns.mean().to_numpy() * TRADING_DAYS
    cov = np.cov(returns.to_numpy(), rowvar=False) * TRADING_DAYS
    cov = np.asarray(cov, dtype=np.float64)
    # Symmetrise to kill floating-point asymmetry before the browser uses it.
    cov = (cov + cov.T) / 2.0

    vols = np.sqrt(np.diag(cov))
    mcaps = np.array([caps[t] for t in keep], dtype=np.float64)
    weights = mcaps / mcaps.sum()

    universe = [
        {
            "ticker": t,
            "name": names.get(t, t),
            "sector": sectors.get(t, "Unknown"),
            "marketCap": mcaps[i],
            "weight": weights[i],
            "meanReturn": float(mu[i]),
            "vol": float(vols[i]),
        }
        for i, t in enumerate(keep)
    ]

    meta = {
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "Yahoo Finance via yfinance",
        "count": len(keep),
        "startDate": str(prices.index[0].date()),
        "endDate": str(prices.index[-1].date()),
        "observations": int(returns.shape[0]),
        "tradingDays": TRADING_DAYS,
    }
    return universe, cov, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="equity/SP500 Tickers.txt")
    ap.add_argument("--out", default="app/public/data")
    ap.add_argument("--start", default="2021-01-01")
    ap.add_argument("--end", default=None)
    ap.add_argument("--limit", type=int, default=None, help="cap ticker count (testing)")
    args = ap.parse_args()

    end = args.end or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tickers = read_tickers(args.tickers, args.limit)
    print(f"Universe: {len(tickers)} tickers, {args.start} to {end}")

    print("Fetching prices...")
    prices = fetch_prices(tickers, args.start, end)
    print(f"  got {prices.shape[1]} price series, {prices.shape[0]} rows")

    print("Fetching market caps and metadata...")
    caps, names, sectors = fetch_market_caps(list(prices.columns))
    print(f"  got market caps for {len(caps)}")

    print("Building snapshot...")
    universe, cov, meta = build_snapshot(prices, caps, names, sectors)
    print(f"  {meta['count']} usable names, {meta['observations']} return observations")

    os.makedirs(args.out, exist_ok=True)
    json_path = os.path.join(args.out, "equity_universe.json")
    cov_path = os.path.join(args.out, "equity_cov.f32")

    with open(json_path, "w") as fh:
        json.dump({"meta": meta, "universe": universe}, fh, separators=(",", ":"))
    cov.astype("<f4").tofile(cov_path)

    print(f"\nWrote {json_path} ({os.path.getsize(json_path) / 1024:.0f} KB)")
    print(f"Wrote {cov_path} ({os.path.getsize(cov_path) / 1024:.0f} KB, {cov.shape[0]}x{cov.shape[1]} float32)")


if __name__ == "__main__":
    main()
