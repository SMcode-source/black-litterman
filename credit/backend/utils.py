"""
Utility Functions
=================
Shared helpers for bond file parsing and data estimation:

  - compute_ytm()                 Newton-Raphson YTM solver
  - years_to_maturity_from_date() Parse date string → years remaining
  - infer_maturity_bucket()       Years → bucket label (e.g. "3-5y")
  - resolve_columns()             Fuzzy-match CSV headers to canonical names
  - safe_numeric()                Extract number from a row with fallback
  - estimate_oas()                Estimate OAS from YTM and rating

Constants:
  - RATING_PD_MAP       Annual default probabilities by rating
  - RATING_SPREAD_MAP   Typical OAS levels by rating
  - COLUMN_ALIASES      Accepted header names for each field
"""
import math
from datetime import datetime, date

import pandas as pd


# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

# Annual probability of default by credit rating (approximate Moody's)
RATING_PD_MAP = {
    "AAA": 0.0001, "AA+": 0.0002, "AA": 0.0003, "AA-": 0.0004,
    "A+":  0.0006, "A":   0.0008, "A-":  0.0012,
    "BBB+": 0.0020, "BBB": 0.0035, "BBB-": 0.0055,
    "BB+": 0.0080, "BB":  0.0120, "BB-":  0.0180,
    "B+":  0.0300, "B":   0.0500, "B-":   0.0800,
}

# Typical OAS (bp) by rating — used when OAS must be estimated
RATING_SPREAD_MAP = {
    "AAA": 35,  "AA+": 45,  "AA": 50,   "AA-": 55,
    "A+":  65,  "A":   75,  "A-": 85,
    "BBB+": 105, "BBB": 130, "BBB-": 160,
    "BB+": 220, "BB":  300, "BB-":  400,
}

# Flexible column name aliases — maps canonical field → accepted CSV headers
COLUMN_ALIASES = {
    "id":              ["id", "ticker", "symbol", "bond_id", "isin", "cusip", "identifier"],
    "issuer":          ["issuer", "issuer_name", "name", "company", "entity"],
    "sector":          ["sector", "industry", "sector_name", "industry_group"],
    "rating":          ["rating", "credit_rating", "sp_rating", "moody_rating", "fitch_rating"],
    "oas":             ["oas", "option_adjusted_spread", "spread", "z_spread", "oas_bp", "spread_bp"],
    "spread_duration": ["spread_duration", "spread_dur", "spd_dur", "sd", "sprd_dur", "duration"],
    "pd_annual":       ["pd_annual", "pd", "default_prob", "probability_of_default", "annual_pd"],
    "lgd":             ["lgd", "loss_given_default", "severity"],
    "mkt_value":       ["mkt_value", "market_value", "mv", "notional", "par_amount", "amount", "weight"],
    "maturity_bucket": ["maturity_bucket", "mat_bucket", "bucket", "tenor_bucket"],
    "coupon_rate":     ["coupon_rate", "coupon", "cpn", "coupon_pct"],
    "maturity_date":   ["maturity_date", "maturity", "mat_date", "matdate"],
    "face_value":      ["face_value", "par_value", "par", "face", "fv"],
    "market_price":    ["market_price", "price", "clean_price", "dirty_price", "px"],
    "ytm":             ["ytm", "yield", "yield_to_maturity", "yld", "yield_pct"],
}


# ---------------------------------------------------------------------------
# YTM calculation
# ---------------------------------------------------------------------------
def compute_ytm(face_value, market_price, coupon_rate, years_to_maturity, freq=2):
    """Solve for yield-to-maturity using Newton-Raphson iteration.

    Args:
        face_value:         Par/face value (e.g. 100)
        market_price:       Current market price
        coupon_rate:        Annual coupon rate in percent (e.g. 5.0 for 5%)
        years_to_maturity:  Years until bond matures
        freq:               Coupon payments per year (default: 2 = semi-annual)

    Returns:
        Annual yield in percent (e.g. 5.25 for 5.25%)
    """
    if years_to_maturity <= 0 or market_price <= 0:
        return 0.0

    coupon = face_value * (coupon_rate / 100.0) / freq
    n_periods = max(int(round(years_to_maturity * freq)), 1)
    ytm_guess = (coupon * freq) / market_price  # initial guess: current yield

    for _ in range(200):
        r = max(ytm_guess / freq, 1e-12)
        disc = 1 + r

        # Price given current guess
        pv_coupons = coupon * (1 - disc ** (-n_periods)) / r
        price = pv_coupons + face_value * disc ** (-n_periods)

        # Numerical derivative (finite difference)
        r2 = r + 0.0001
        disc2 = 1 + r2
        price2 = coupon * (1 - disc2 ** (-n_periods)) / r2 + face_value * disc2 ** (-n_periods)
        deriv = (price2 - price) / 0.0001

        if abs(deriv) < 1e-15:
            break

        # Newton step
        ytm_guess -= (price - market_price) / deriv * freq

        if abs(price - market_price) < 0.0001:
            break

    return round(ytm_guess * 100, 4)


# ---------------------------------------------------------------------------
# Date & maturity helpers
# ---------------------------------------------------------------------------
def years_to_maturity_from_date(mat_date_str):
    """Parse a maturity date string and return years from today.

    Tries multiple common date formats. Returns 0.0 if none match.
    """
    formats = ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%d-%b-%y")
    for fmt in formats:
        try:
            mat_date = datetime.strptime(str(mat_date_str).strip(), fmt).date()
            return max((mat_date - date.today()).days / 365.25, 0.01)
        except (ValueError, TypeError):
            continue
    return 0.0


def infer_maturity_bucket(years):
    """Map years-to-maturity into a standard bucket label."""
    if years <= 3:
        return "1-3y"
    if years <= 5:
        return "3-5y"
    if years <= 7:
        return "5-7y"
    if years <= 10:
        return "7-10y"
    return "10y+"


# ---------------------------------------------------------------------------
# Column resolution & numeric extraction
# ---------------------------------------------------------------------------
def resolve_columns(df):
    """Match DataFrame columns to canonical field names using COLUMN_ALIASES.

    Returns a dict like {"id": "Ticker", "oas": "OAS_BP", ...}
    mapping canonical names → actual column names in the DataFrame.
    """
    col_map = {}
    df_cols_lower = {c.lower().strip().replace(" ", "_"): c for c in df.columns}

    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in df_cols_lower:
                col_map[canonical] = df_cols_lower[alias]
                break

    return col_map


def safe_numeric(row, col_map, field, default=None):
    """Extract a numeric value from a DataFrame row.

    Returns `default` if the field isn't in col_map or the value isn't numeric.
    """
    if field not in col_map:
        return default
    val = pd.to_numeric(row.get(col_map[field], None), errors="coerce")
    return float(val) if pd.notna(val) else default


# ---------------------------------------------------------------------------
# OAS estimation
# ---------------------------------------------------------------------------
def estimate_oas(ytm_val, rating, years_to_mat):
    """Estimate OAS (bp) from YTM and rating when not provided directly.

    Uses a simple risk-free proxy subtracted from YTM, floored by
    a fraction of the typical rating-based spread.
    """
    # Rough risk-free rate proxy by maturity
    rf_proxy = 4.0 if years_to_mat <= 5 else (4.2 if years_to_mat <= 10 else 4.5)

    ytm_based = (ytm_val - rf_proxy) * 100            # convert % to bp
    rating_based = RATING_SPREAD_MAP.get(rating, 80)   # typical spread for this rating

    return round(max(ytm_based, rating_based * 0.5, 10), 1)
