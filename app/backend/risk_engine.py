"""
Risk Engine
===========
Credit-specific risk analytics for the portfolio optimiser:

  - Covariance estimation (factor model or Ledoit-Wolf shrinkage)
  - Expected default loss (PD x LGD)
  - Rating migration loss (transition-matrix-based)
  - Monte Carlo Credit VaR via Gaussian copula
"""
import numpy as np
from scipy.stats import norm

# ---------------------------------------------------------------------------
# Rating & transition data
# ---------------------------------------------------------------------------
RATING_ORDER = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-"]

# Maps granular ratings → broad bucket index (for transition matrix rows)
RATING_BUCKETS = {
    "AAA": 0,
    "AA+": 1, "AA": 1, "AA-": 1,
    "A+": 2, "A": 2, "A-": 2,
    "BBB+": 3, "BBB": 3, "BBB-": 3,
}

# Simplified Moody's-style 1-year transition matrix
# Rows/cols: AAA, AA, A, BBB, BB(HY), Default
TRANSITION_MATRIX = np.array([
    [0.9081, 0.0833, 0.0068, 0.0006, 0.0012, 0.0000],  # from AAA
    [0.0070, 0.9065, 0.0779, 0.0064, 0.0006, 0.0016],  # from AA
    [0.0009, 0.0227, 0.9105, 0.0552, 0.0074, 0.0033],  # from A
    [0.0002, 0.0033, 0.0595, 0.8693, 0.0530, 0.0147],  # from BBB
    [0.0003, 0.0014, 0.0067, 0.0773, 0.8053, 0.1090],  # from BB
    [0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 1.0000],  # from Default (absorbing)
])

# Spread change (bp) when migrating from row-bucket to col-bucket
MIGRATION_SPREAD_CHANGE = np.array([
    [0,    -15,   -70,  -200,  -400, -600],
    [15,     0,   -55,  -180,  -380, -580],
    [70,    55,     0,  -120,  -320, -520],
    [200,  180,   120,     0,  -200, -400],
    [400,  380,   320,   200,     0, -200],
    [600,  580,   520,   400,   200,    0],
])

SECTOR_LIST = [
    "Technology", "Financials", "Healthcare", "Energy",
    "Consumer Staples", "Communications", "Utilities",
    "Industrials", "Consumer Disc.", "Real Estate", "Materials",
]


def _rating_bucket_index(rating: str) -> int:
    """Map a granular rating (e.g. 'A+') to its transition matrix row index."""
    return min(RATING_BUCKETS.get(rating, 3), 4)


# ---------------------------------------------------------------------------
# Covariance estimation
# ---------------------------------------------------------------------------
def build_covariance_matrix(
    oas, spread_dur, sectors, ratings, mat_buckets, method="factor_model",
):
    """Dispatch to the chosen covariance estimator."""
    if method == "factor_model":
        return _factor_model_cov(oas, spread_dur, sectors, ratings, mat_buckets)
    else:
        return _ledoit_wolf_cov(oas, spread_dur, sectors, ratings)


def _factor_model_cov(oas, spread_dur, sectors, ratings, mat_buckets):
    """Structured factor-model covariance:  Sigma = B * V * B' + D

    Factors: 1 market + 11 sector + 4 rating + 5 curve = 21 total.
    Each bond loads onto its market/sector/rating/curve factors.
    Idiosyncratic risk (D) is 35% of total variance.
    """
    n = len(oas)

    # Per-bond spread return volatility: sigma_i ~ OAS * SD * 0.30
    vols = (oas / 10000.0) * spread_dur * 0.30

    # --- Build factor loadings matrix B ---
    sector_map = {s: i for i, s in enumerate(SECTOR_LIST)}
    bucket_map = {"1-3y": 0, "3-5y": 1, "5-7y": 2, "7-10y": 3, "10y+": 4}
    n_sectors, n_ratings, n_curve = len(SECTOR_LIST), 4, 5
    n_factors = 1 + n_sectors + n_ratings + n_curve

    B = np.zeros((n, n_factors))
    for i in range(n):
        B[i, 0] = 1.0                                               # market beta
        B[i, 1 + sector_map.get(sectors[i], 0)] = 0.7               # sector loading
        B[i, 1 + n_sectors + RATING_BUCKETS.get(ratings[i], 3)] = 0.5  # rating loading
        B[i, 1 + n_sectors + n_ratings + bucket_map.get(mat_buckets[i], 1)] = 0.3  # curve

    # --- Factor covariance matrix V ---
    V = np.eye(n_factors) * (0.0015 ** 2)           # base variance
    V[0, 0] = 0.0050 ** 2                           # market factor ~50bp vol
    for j in range(1, 1 + n_sectors):
        V[j, j] = 0.0025 ** 2                       # sector factors ~25bp
    for j in range(1 + n_sectors, 1 + n_sectors + n_ratings):
        V[j, j] = 0.0020 ** 2                       # rating factors ~20bp
    for j in range(1 + n_sectors + n_ratings, n_factors):
        V[j, j] = 0.0015 ** 2                       # curve factors ~15bp

    # Systematic covariance: B * V * B'
    systematic = B @ V @ B.T

    # Idiosyncratic (diagonal): 35% of total variance
    D = np.diag((vols * np.sqrt(0.35)) ** 2)

    # Combine and scale by individual volatilities
    sigma = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            denom = (np.sqrt(systematic[i, i] + D[i, i])
                     * np.sqrt(systematic[j, j] + D[j, j]) + 1e-12)
            sigma[i, j] = systematic[i, j] * vols[i] * vols[j] / denom * vols[i] * vols[j]
    np.fill_diagonal(sigma, vols ** 2)

    # Ensure positive semi-definite
    eigvals, eigvecs = np.linalg.eigh(sigma)
    eigvals = np.maximum(eigvals, 1e-10)
    sigma = eigvecs @ np.diag(eigvals) @ eigvecs.T
    return (sigma + sigma.T) / 2


def _ledoit_wolf_cov(oas, spread_dur, sectors, ratings):
    """Ledoit-Wolf shrinkage: shrink structured correlation toward single-factor target."""
    n = len(oas)
    vols = (oas / 10000.0) * spread_dur * 0.30

    # Build structured correlation (sector + rating proximity)
    corr = np.full((n, n), 0.20)
    for i in range(n):
        for j in range(i, n):
            c = 0.20
            if sectors[i] == sectors[j]:
                c += 0.35
            ri = RATING_ORDER.index(ratings[i]) if ratings[i] in RATING_ORDER else 5
            rj = RATING_ORDER.index(ratings[j]) if ratings[j] in RATING_ORDER else 5
            c += max(0, 0.10 - abs(ri - rj) * 0.02)
            if i == j:
                c = 1.0
            corr[i, j] = min(c, 0.95)
            corr[j, i] = corr[i, j]

    # Shrink toward average-correlation target
    avg_corr = (corr.sum() - n) / (n * (n - 1))
    target = np.full((n, n), avg_corr)
    np.fill_diagonal(target, 1.0)

    shrunk = 0.7 * corr + 0.3 * target  # 30% shrinkage
    return np.outer(vols, vols) * shrunk


# ---------------------------------------------------------------------------
# Expected loss & migration loss
# ---------------------------------------------------------------------------
def compute_expected_losses(pd, lgd):
    """EL_i = PD_i x LGD_i  (vectorised)."""
    return pd * lgd


def compute_migration_loss(ratings, spread_dur):
    """Expected spread loss from probability-weighted rating migrations.

    For each bond, sum across all possible migration destinations:
        loss_i += P(migrate to j) * spread_change(i→j) * spread_duration_i
    """
    n = len(ratings)
    loss = np.zeros(n)
    for i in range(n):
        ri = _rating_bucket_index(ratings[i])
        for j in range(6):
            loss[i] += (TRANSITION_MATRIX[ri, j]
                        * (MIGRATION_SPREAD_CHANGE[ri, j] / 10000.0)
                        * spread_dur[i])
    return loss


# ---------------------------------------------------------------------------
# Monte Carlo Credit VaR  (Gaussian copula)
# ---------------------------------------------------------------------------
def monte_carlo_credit_var(
    weights, pd, lgd, ratings, spread_dur, sectors,
    n_sim=50000, confidence=0.99, seed=42,
):
    """Simulate portfolio credit losses using a Gaussian copula model.

    Steps:
      1. Build asset correlation from sector structure
      2. Cholesky decomposition for correlated draws
      3. Compute default/downgrade thresholds from PD and transition matrix
      4. For each simulation: draw correlated normals → check default/downgrade
      5. Compute VaR and CVaR at the given confidence level
    """
    rng = np.random.default_rng(seed)
    n = len(weights)

    # --- Step 1: Asset correlation (same sector = 0.50, cross-sector = 0.20) ---
    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            c = 0.50 if sectors[i] == sectors[j] else 0.20
            corr[i, j] = corr[j, i] = c

    # --- Step 2: Cholesky (with PSD fix if needed) ---
    try:
        L = np.linalg.cholesky(corr)
    except np.linalg.LinAlgError:
        eigvals, eigvecs = np.linalg.eigh(corr)
        eigvals = np.maximum(eigvals, 1e-8)
        corr = eigvecs @ np.diag(eigvals) @ eigvecs.T
        corr = (corr + corr.T) / 2
        np.fill_diagonal(corr, 1.0)
        L = np.linalg.cholesky(corr)

    # --- Step 3: Thresholds ---
    default_thresh = norm.ppf(pd)  # Z below this → default
    downgrade_thresh = np.zeros(n)
    for i in range(n):
        ri = _rating_bucket_index(ratings[i])
        p_down = sum(TRANSITION_MATRIX[ri, ri + 1:]) if ri < 5 else 0
        downgrade_thresh[i] = norm.ppf(max(p_down, 1e-10))

    # --- Step 4: Simulate losses ---
    Z = rng.standard_normal((n_sim, n))
    corr_Z = Z @ L.T  # correlated draws

    losses = np.zeros(n_sim)
    for sim in range(n_sim):
        for i in range(n):
            if weights[i] < 1e-8:
                continue
            z = corr_Z[sim, i]
            if z < default_thresh[i]:
                losses[sim] += weights[i] * lgd[i]           # default loss
            elif z < downgrade_thresh[i]:
                ri = _rating_bucket_index(ratings[i])
                spread_bp = abs(MIGRATION_SPREAD_CHANGE[ri, min(ri + 1, 5)]) / 10000.0
                losses[sim] += weights[i] * spread_bp * spread_dur[i]  # downgrade loss

    # --- Step 5: VaR / CVaR ---
    sorted_losses = np.sort(losses)
    var_idx = int(n_sim * confidence)
    var_99 = sorted_losses[min(var_idx, n_sim - 1)]
    cvar_99 = sorted_losses[var_idx:].mean() if var_idx < n_sim else var_99

    return {
        "var_99": float(var_99),
        "cvar_99": float(cvar_99),
        "mean_loss": float(losses.mean()),
        "percentiles": [float(np.percentile(losses, p)) for p in range(0, 101, 5)],
    }
