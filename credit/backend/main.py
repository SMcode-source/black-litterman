"""
Black-Litterman Credit Portfolio Optimiser — FastAPI Application
================================================================
Three endpoints:
  POST /api/v1/optimise       Full BL pipeline → optimal weights + risk
  POST /api/v1/equilibrium    Equilibrium returns only (no views/optimisation)
  POST /api/v1/upload-bonds   Parse CSV/TXT/Excel into bond universe
"""
import io
import os

import numpy as np
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    OptimisationRequest, OptimisationResponse, IssuerResult,
    RiskMetrics, SectorAllocation, RatingAllocation, ConstraintStatus,
    ParsedBond, UploadResponse,
)
from risk_engine import (
    build_covariance_matrix, compute_expected_losses,
    compute_migration_loss, monte_carlo_credit_var,
)
from bl_engine import (
    compute_equilibrium, build_view_matrices,
    compute_posterior, optimise_portfolio,
)
from utils import (
    compute_ytm, years_to_maturity_from_date, infer_maturity_bucket,
    resolve_columns, safe_numeric, estimate_oas,
    RATING_PD_MAP,
)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://black-litterman-credit.onrender.com",
).split(",")

app = FastAPI(
    title="Black-Litterman Credit Optimiser API",
    version="1.0.0",
    description="Portfolio optimisation for IG credit using the BL framework.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RATING_BUCKET_MAP = {
    "AAA": ["AAA"],
    "AA": ["AA+", "AA", "AA-"],
    "A": ["A+", "A", "A-"],
    "BBB": ["BBB+", "BBB", "BBB-"],
}


def _extract_bond_arrays(bonds):
    """Unpack a list of BondData into parallel numpy arrays and lists."""
    return {
        "ids":      [b.id for b in bonds],
        "issuers":  [b.issuer for b in bonds],
        "sectors":  [b.sector for b in bonds],
        "ratings":  [b.rating for b in bonds],
        "buckets":  [b.maturity_bucket for b in bonds],
        "oas":      np.array([b.oas for b in bonds]),
        "sd":       np.array([b.spread_duration for b in bonds]),
        "pd":       np.array([b.pd_annual for b in bonds]),
        "lgd":      np.array([b.lgd for b in bonds]),
        "mv":       np.array([b.mkt_value for b in bonds]),
    }


def _allocation_by_mask(items, labels, w_opt, w_mkt):
    """Compute benchmark/optimal/active weights grouped by labels."""
    result = []
    for label in labels:
        mask = np.array([1.0 if x == label else 0.0 for x in items])
        bmk = float(mask @ w_mkt) * 100
        opt = float(mask @ w_opt) * 100
        result.append({"label": label, "bmk": round(bmk, 2), "opt": round(opt, 2)})
    return result


# ===========================================================================
# POST /api/v1/optimise  —  Full Black-Litterman pipeline
# ===========================================================================
@app.post("/api/v1/optimise", response_model=OptimisationResponse)
def run_optimisation(req: OptimisationRequest):
    warnings = []
    n = len(req.bonds)
    d = _extract_bond_arrays(req.bonds)

    # --- Step 0: Validate inputs ---
    if np.any(d["oas"] <= 0):
        bad = [d["ids"][i] for i in range(n) if d["oas"][i] <= 0]
        warnings.append(f"Non-positive OAS for: {bad}.")

    # --- Step 1: Benchmark weights (market-value-weighted) ---
    w_mkt = d["mv"] / d["mv"].sum()

    # --- Step 2: Covariance matrix ---
    cov = build_covariance_matrix(
        d["oas"], d["sd"], d["sectors"], d["ratings"],
        d["buckets"], req.covariance_method,
    )

    # --- Step 3: Equilibrium returns  π = δΣw  adjusted for credit losses ---
    el = compute_expected_losses(d["pd"], d["lgd"])
    mig = compute_migration_loss(d["ratings"], d["sd"])
    pi_raw, pi_adj = compute_equilibrium(cov, w_mkt, req.delta, el, mig)

    # --- Step 4: Incorporate manager views → posterior returns ---
    views = [
        {"view_type": v.view_type, "long_assets": v.long_assets,
         "short_assets": v.short_assets, "magnitude_bp": v.magnitude_bp,
         "confidence": v.confidence}
        for v in req.views
    ]
    view_result = build_view_matrices(views, d["ids"], cov, req.tau)

    if view_result is not None:
        P, Q, omega = view_result
        mu_bl, sigma_bl = compute_posterior(pi_adj, cov, req.tau, P, Q, omega)
    else:
        mu_bl, sigma_bl = compute_posterior(pi_adj, cov, req.tau, None, None, None)
        warnings.append("No valid views. Using equilibrium returns only.")

    # --- Step 5: Constrained optimisation  max w'μ - (δ/2)w'Σw ---
    constraints = {
        "max_issuer_weight":       req.constraints.max_issuer_weight,
        "min_position_size":       req.constraints.min_position_size,
        "max_sector_overweight":   req.constraints.max_sector_overweight,
        "max_tracking_error":      req.constraints.max_tracking_error,
        "spread_duration_tolerance": req.constraints.spread_duration_tolerance,
        "excluded_issuers":        req.constraints.excluded_issuers,
    }
    w_opt, solver_status, binding = optimise_portfolio(
        mu_bl, sigma_bl, req.delta, w_mkt,
        d["sectors"], d["ratings"], d["sd"], constraints, cov,
    )

    # --- Step 6: Compute portfolio-level risk metrics ---
    active_w = w_opt - w_mkt
    port_ret = float(w_opt @ mu_bl) * 10000          # bp
    port_vol = np.sqrt(float(w_opt @ cov @ w_opt)) * 10000
    te = np.sqrt(float(active_w @ cov @ active_w)) * 10000
    bmk_ret = float(w_mkt @ mu_bl) * 10000

    risk_metrics = RiskMetrics(
        portfolio_return_bp=round(port_ret, 2),
        portfolio_vol_bp=round(port_vol, 2),
        sharpe_ratio=round(port_ret / port_vol if port_vol > 0 else 0, 4),
        tracking_error_bp=round(te, 2),
        information_ratio=round((port_ret - bmk_ret) / te if te > 0 else 0, 4),
        expected_loss_bp=round(float(w_opt @ el) * 10000, 2),
        spread_duration=round(float(w_opt @ d["sd"]), 3),
        dts=round(float(w_opt @ (d["oas"] / 10000 * d["sd"])) * 10000, 2),
        credit_var_99_bp=0.0,   # filled below
        credit_cvar_99_bp=0.0,
    )

    # --- Step 7: Monte Carlo Credit VaR ---
    mc = monte_carlo_credit_var(
        w_opt, d["pd"], d["lgd"], d["ratings"], d["sd"], d["sectors"],
        n_sim=req.n_simulations,
    )
    risk_metrics.credit_var_99_bp = round(mc["var_99"] * 10000, 2)
    risk_metrics.credit_cvar_99_bp = round(mc["cvar_99"] * 10000, 2)

    # --- Step 8: Per-issuer results ---
    issuer_results = [
        IssuerResult(
            id=d["ids"][i], issuer=d["issuers"][i],
            sector=d["sectors"][i], rating=d["ratings"][i],
            benchmark_weight=round(float(w_mkt[i]) * 100, 4),
            optimal_weight=round(float(w_opt[i]) * 100, 4),
            active_weight=round(float(active_w[i]) * 100, 4),
            equilibrium_return_bp=round(float(pi_adj[i]) * 10000, 2),
            posterior_return_bp=round(float(mu_bl[i]) * 10000, 2),
            expected_loss_bp=round(float(el[i]) * 10000, 2),
            dts=round(float(d["oas"][i] / 10000 * d["sd"][i]) * 10000, 2),
        )
        for i in range(n)
    ]

    # --- Step 9: Sector & rating allocation breakdown ---
    sector_alloc = [
        SectorAllocation(sector=a["label"], benchmark=a["bmk"],
                         optimal=a["opt"], active=round(a["opt"] - a["bmk"], 2))
        for a in _allocation_by_mask(d["sectors"], sorted(set(d["sectors"])), w_opt, w_mkt)
    ]

    rating_alloc = []
    for bucket, granular in RATING_BUCKET_MAP.items():
        mask = np.array([1.0 if r in granular else 0.0 for r in d["ratings"]])
        bmk = round(float(mask @ w_mkt) * 100, 2)
        opt = round(float(mask @ w_opt) * 100, 2)
        rating_alloc.append(RatingAllocation(
            rating_bucket=bucket, benchmark=bmk, optimal=opt, active=round(opt - bmk, 2),
        ))

    # --- Step 10: Return everything ---
    return OptimisationResponse(
        status="success",
        solver_status=solver_status,
        issuer_results=issuer_results,
        risk_metrics=risk_metrics,
        sector_allocation=sector_alloc,
        rating_allocation=rating_alloc,
        constraint_status=[
            ConstraintStatus(name=c["name"], bound=c["bound"], value=0, active=False)
            for c in binding
        ],
        var_distribution=mc["percentiles"],
        warnings=warnings,
    )


# ===========================================================================
# POST /api/v1/equilibrium  —  Equilibrium returns only (no views)
# ===========================================================================
@app.post("/api/v1/equilibrium")
def get_equilibrium(req: OptimisationRequest):
    d = _extract_bond_arrays(req.bonds)
    w_mkt = d["mv"] / d["mv"].sum()
    cov = build_covariance_matrix(
        d["oas"], d["sd"], d["sectors"], d["ratings"],
        d["buckets"], req.covariance_method,
    )
    el = compute_expected_losses(d["pd"], d["lgd"])
    mig = compute_migration_loss(d["ratings"], d["sd"])
    pi_raw, pi_adj = compute_equilibrium(cov, w_mkt, req.delta, el, mig)

    return {
        "equilibrium_returns": {
            b.id: {
                "raw_bp": round(float(pi_raw[i]) * 10000, 2),
                "adjusted_bp": round(float(pi_adj[i]) * 10000, 2),
            }
            for i, b in enumerate(req.bonds)
        }
    }


# ===========================================================================
# POST /api/v1/upload-bonds  —  Parse file into bond universe
# ===========================================================================
@app.post("/api/v1/upload-bonds", response_model=UploadResponse)
async def upload_bonds(file: UploadFile = File(...)):
    """Parse CSV, TXT, or Excel into structured bond data.

    Pipeline:
      1. Read & detect file format
      2. Map column names via flexible aliases
      3. For each row: extract fields, calculate missing YTM/OAS/SD
      4. Return parsed bonds + any warnings/errors
    """
    warnings, errors = [], []
    content = await file.read()
    filename = (file.filename or "").lower()

    # --- Step 1: Read file into DataFrame ---
    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content), engine="openpyxl")
        elif filename.endswith((".csv", ".txt")):
            text = content.decode("utf-8", errors="replace")
            for sep in [",", "\t", ";", "|"]:
                df = pd.read_csv(io.StringIO(text), sep=sep)
                if len(df.columns) > 2:
                    break
        else:
            raise HTTPException(400, "Unsupported file type. Use .csv, .txt, .xlsx, or .xls")
        if df.empty:
            raise HTTPException(400, "Uploaded file contains no data rows.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {e}")

    # --- Step 2: Resolve column aliases ---
    col_map = resolve_columns(df)
    if "id" not in col_map and "issuer" not in col_map:
        return UploadResponse(
            status="error", bonds=[], row_count=0,
            errors=["File must have an 'id' or 'issuer' column."],
        )

    # --- Step 3: Parse each row into a bond ---
    parsed = []
    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-indexed, accounting for header
        try:
            bond = _parse_bond_row(row, row_num, col_map, warnings)
            if bond:
                parsed.append(bond)
        except Exception as e:
            errors.append(f"Row {row_num}: Failed to parse — {e}")

    if not parsed and not errors:
        errors.append("No valid bonds could be parsed from the file.")

    return UploadResponse(
        status="success" if parsed else "error",
        bonds=parsed,
        row_count=len(parsed),
        warnings=warnings[:50],
        errors=errors[:50],
    )


def _parse_bond_row(row, row_num, col_map, warnings):
    """Parse a single DataFrame row into a ParsedBond, or return None to skip.

    Steps for each row:
      a) Extract id/issuer (skip if both empty)
      b) Extract sector, rating (with defaults)
      c) Read numeric fields: OAS, spread duration, coupon, price
      d) Parse maturity date → years to maturity
      e) Calculate YTM from coupon/price/maturity if missing
      f) Estimate spread duration from maturity if missing
      g) Estimate OAS from YTM/rating if missing
      h) Assign maturity bucket
      i) Apply safe defaults for PD, LGD, market value
    """
    # (a) Identity
    raw_id = str(row.get(col_map.get("id", ""), "")).strip()
    raw_issuer = str(row.get(col_map.get("issuer", ""), "")).strip()
    if not raw_id and not raw_issuer:
        return None
    bond_id = raw_id if raw_id and raw_id != "nan" else raw_issuer[:8].upper().replace(" ", "")
    issuer = raw_issuer if raw_issuer and raw_issuer != "nan" else raw_id

    # (b) Sector & rating
    sector = str(row.get(col_map.get("sector", ""), "Other")).strip()
    if sector in ("nan", ""):
        sector = "Other"
    rating = str(row.get(col_map.get("rating", ""), "")).strip().upper()
    if rating in ("NAN", ""):
        rating = "BBB"
        warnings.append(f"Row {row_num}: No rating, defaulting to BBB.")

    # (c) Numeric fields
    oas_val = safe_numeric(row, col_map, "oas", 0.0)
    if oas_val is not None and oas_val <= 0:
        oas_val = 0.0
    sd_val = safe_numeric(row, col_map, "spread_duration", 0.0)
    if sd_val is not None and sd_val <= 0:
        sd_val = 0.0
    coupon = safe_numeric(row, col_map, "coupon_rate")
    face_val = safe_numeric(row, col_map, "face_value") or 100.0
    mkt_price = safe_numeric(row, col_map, "market_price")

    # (d) Maturity date → years
    years_to_mat = 0.0
    mat_date_str = None
    if "maturity_date" in col_map:
        mat_date_str = str(row.get(col_map["maturity_date"], "")).strip()
        if mat_date_str and mat_date_str != "nan":
            years_to_mat = years_to_maturity_from_date(mat_date_str)
        else:
            mat_date_str = None

    # (e) YTM: use provided, or calculate from coupon + price + maturity
    ytm_val = safe_numeric(row, col_map, "ytm")
    if ytm_val is None and coupon is not None and mkt_price is not None and years_to_mat > 0:
        ytm_val = compute_ytm(face_val, mkt_price, coupon, years_to_mat)
        if ytm_val > 0:
            warnings.append(f"Row {row_num} ({bond_id}): YTM calculated as {ytm_val:.2f}%.")

    # (f) Estimate spread duration from maturity if missing
    if sd_val <= 0 and years_to_mat > 0:
        sd_val = round(years_to_mat * 0.85, 2)
        warnings.append(f"Row {row_num} ({bond_id}): Spread duration estimated as {sd_val:.1f}y.")

    # (g) Estimate OAS from YTM/rating if missing
    if oas_val <= 0 and ytm_val is not None:
        oas_val = estimate_oas(ytm_val, rating, years_to_mat)
        warnings.append(f"Row {row_num} ({bond_id}): OAS estimated as {oas_val:.0f} bp.")

    # (h) Maturity bucket
    mat_bucket = None
    if "maturity_bucket" in col_map:
        mb = str(row.get(col_map["maturity_bucket"], "")).strip()
        mat_bucket = mb if mb and mb != "nan" else None
    if not mat_bucket:
        mat_bucket = infer_maturity_bucket(years_to_mat) if years_to_mat > 0 else "3-5y"

    # Skip if we can't determine either OAS or spread duration
    if oas_val <= 0 and sd_val <= 0:
        return None  # caller should log an error

    # Apply safe defaults
    if oas_val <= 0:
        oas_val = 50
        warnings.append(f"Row {row_num} ({bond_id}): OAS defaulted to 50 bp.")
    if sd_val <= 0:
        sd_val = 4.0
        warnings.append(f"Row {row_num} ({bond_id}): Spread duration defaulted to 4.0y.")

    # (i) PD, LGD, market value
    pd_val = safe_numeric(row, col_map, "pd_annual")
    if pd_val is None or pd_val <= 0:
        pd_val = RATING_PD_MAP.get(rating, 0.003)
    lgd_val = safe_numeric(row, col_map, "lgd")
    if lgd_val is None or not (0 <= lgd_val <= 1):
        lgd_val = 0.4
    mv_val = safe_numeric(row, col_map, "mkt_value")
    if mv_val is None or mv_val <= 0:
        mv_val = 1000.0

    return ParsedBond(
        id=bond_id, issuer=issuer, sector=sector, rating=rating,
        oas=oas_val, spread_duration=sd_val, pd_annual=pd_val,
        lgd=lgd_val, mkt_value=mv_val, maturity_bucket=mat_bucket,
        coupon_rate=coupon, maturity_date=mat_date_str,
        face_value=face_val, market_price=mkt_price, ytm=ytm_val,
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "engine": "bl-credit-optimiser", "version": "1.0.0"}
