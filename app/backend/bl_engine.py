"""
Black-Litterman Engine
======================
Implements the four core steps of the BL model:

  1. compute_equilibrium   — Reverse-optimise implied returns from market weights
  2. build_view_matrices   — Translate manager views into P, Q, Omega matrices
  3. compute_posterior      — Bayesian blend of prior (equilibrium) and views
  4. optimise_portfolio     — Constrained QP to find optimal weights

References:
  - Black & Litterman (1992), "Global Portfolio Optimization"
  - Idzorek (2005), "A Step-by-Step Guide to the BL Model"
"""
import numpy as np
import cvxpy as cp
from typing import Optional


def _ensure_psd(matrix: np.ndarray) -> np.ndarray:
    """Force a matrix to be positive semi-definite via eigenvalue floor."""
    eigvals, eigvecs = np.linalg.eigh(matrix)
    eigvals = np.maximum(eigvals, 1e-10)
    psd = eigvecs @ np.diag(eigvals) @ eigvecs.T
    return (psd + psd.T) / 2


# ---------------------------------------------------------------------------
# Step 1: Implied equilibrium returns
# ---------------------------------------------------------------------------
def compute_equilibrium(
    cov: np.ndarray,
    w_mkt: np.ndarray,
    delta: float,
    expected_loss: np.ndarray,
    migration_loss: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Reverse-optimise implied excess returns from benchmark weights.

    Formula:
        pi_raw = delta * Sigma * w_mkt
        pi_adj = pi_raw - expected_loss - migration_loss
    """
    pi_raw = delta * cov @ w_mkt
    pi_adj = pi_raw - expected_loss - migration_loss
    return pi_raw, pi_adj


# ---------------------------------------------------------------------------
# Step 2: Translate views into matrices
# ---------------------------------------------------------------------------
def build_view_matrices(
    views: list[dict],
    bond_ids: list[str],
    cov: np.ndarray,
    tau: float,
) -> Optional[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Build the P (pick) matrix, Q (view returns), and Omega (uncertainty).

    Each view is either:
      ABSOLUTE:  "Bond X will return Q bp"          → P row has +1 on X
      RELATIVE:  "X will outperform Y by Q bp"      → P row has +1/n on longs, -1/n on shorts

    Omega (view uncertainty) uses Idzorek's confidence method:
      omega_ii = tau * (p_i' Sigma p_i) * (1/confidence - 1)

    Returns None if no valid views can be constructed.
    """
    n = len(bond_ids)
    id_map = {bid: i for i, bid in enumerate(bond_ids)}

    # Filter to views that reference at least one valid bond
    valid = []
    for v in views:
        longs = [id_map[a] for a in v["long_assets"] if a in id_map]
        shorts = [id_map[a] for a in v.get("short_assets", []) if a in id_map]
        if longs:
            valid.append((v, longs, shorts))

    if not valid:
        return None

    k = len(valid)
    P = np.zeros((k, n))
    Q = np.zeros(k)
    omega = np.zeros((k, k))

    for vi, (v, longs, shorts) in enumerate(valid):
        # View magnitude (convert bp → decimal)
        Q[vi] = v["magnitude_bp"] / 10000.0

        # Pick matrix row: equal weight across long/short legs
        for idx in longs:
            P[vi, idx] = 1.0 / len(longs)
        if v["view_type"] == "RELATIVE":
            for idx in shorts:
                P[vi, idx] = -1.0 / len(shorts)

        # Omega diagonal: uncertainty inversely proportional to confidence
        p_row = P[vi]
        view_var = p_row @ cov @ p_row  # variance of the view portfolio
        conf = max(min(v.get("confidence", 0.5), 0.999), 0.001)
        omega[vi, vi] = max(tau * view_var * (1.0 / conf - 1.0), 1e-14)

    return P, Q, omega


# ---------------------------------------------------------------------------
# Step 3: Bayesian posterior
# ---------------------------------------------------------------------------
def compute_posterior(
    pi: np.ndarray,
    cov: np.ndarray,
    tau: float,
    P: Optional[np.ndarray],
    Q: Optional[np.ndarray],
    omega: Optional[np.ndarray],
) -> tuple[np.ndarray, np.ndarray]:
    """Bayesian blend of equilibrium prior with manager views.

    When views are provided:
        mu_BL    = [(tau*Sigma)^-1 + P'*Omega^-1*P]^-1
                   * [(tau*Sigma)^-1 * pi  +  P'*Omega^-1 * Q]
        Sigma_BL = Sigma + posterior_cov

    Without views, returns equilibrium returns directly.
    """
    n = len(pi)
    tau_sigma = tau * cov

    # No views → just return equilibrium
    if P is None:
        return pi.copy(), cov + tau_sigma

    # Invert tau*Sigma (with regularisation for numerical stability)
    tau_sigma_inv = np.linalg.inv(tau_sigma + np.eye(n) * 1e-10)

    # Invert Omega (diagonal, so just invert each diagonal element)
    omega_inv = np.diag(1.0 / np.diag(omega))

    # Posterior precision = (tau*Sigma)^-1 + P' * Omega^-1 * P
    posterior_precision = tau_sigma_inv + P.T @ omega_inv @ P
    posterior_cov = np.linalg.inv(posterior_precision + np.eye(n) * 1e-12)

    # Posterior mean
    mu_bl = posterior_cov @ (tau_sigma_inv @ pi + P.T @ omega_inv @ Q)

    # Posterior covariance (total uncertainty = market + estimation)
    sigma_bl = cov + posterior_cov

    return mu_bl, sigma_bl


# ---------------------------------------------------------------------------
# Step 4: Constrained portfolio optimisation
# ---------------------------------------------------------------------------
def optimise_portfolio(
    mu_bl: np.ndarray,
    sigma_bl: np.ndarray,
    delta: float,
    w_mkt: np.ndarray,
    sectors: list[str],
    ratings: list[str],
    spread_dur: np.ndarray,
    constraints: dict,
    cov: np.ndarray,
) -> tuple[np.ndarray, str, list[dict]]:
    """Solve constrained mean-variance QP via cvxpy.

    Objective:  max  w'mu  -  (delta/2) * w'Sigma*w

    Constraints:
      1. Fully invested (sum = 1), long-only, min position size
      2. Max single-issuer weight
      3. Sector over/underweight limits vs benchmark
      4. Spread duration close to benchmark
      5. Tracking error cap
    """
    n = len(mu_bl)
    w = cp.Variable(n)

    # Ensure PSD for the QP solver
    sigma_psd = _ensure_psd(sigma_bl)
    cov_psd = _ensure_psd(cov)

    # --- Objective ---
    objective = cp.Maximize(w @ mu_bl - (delta / 2) * cp.quad_form(w, sigma_psd))

    # --- Constraints ---
    cons = []
    info = []

    # (1) Fully invested, long-only
    cons.append(cp.sum(w) == 1)
    min_w = constraints.get("min_position_size", 0.2) / 100.0
    cons.append(w >= min_w)

    # (2) Max issuer weight (auto-relax if universe is too small)
    max_w = constraints.get("max_issuer_weight", 5.0) / 100.0
    if max_w * n < 1.0:
        max_w = 1.0 / n + 0.10
    cons.append(w <= max_w)
    info.append({"name": "Max issuer weight", "bound": max_w * 100})

    # (3) Sector bounds: benchmark +/- max overweight
    max_ow = constraints.get("max_sector_overweight", 10.0) / 100.0
    for sector in set(sectors):
        mask = np.array([1.0 if s == sector else 0.0 for s in sectors])
        bmk_w = float(mask @ w_mkt)
        if bmk_w > 0.01:
            cons.append(mask @ w <= bmk_w + max_ow)
            cons.append(mask @ w >= max(0, bmk_w - max_ow))

    # (4) Spread duration: stay within tolerance of benchmark
    sd_tol = constraints.get("spread_duration_tolerance", 0.25)
    bmk_sd = float(w_mkt @ spread_dur)
    cons.append(w @ spread_dur <= bmk_sd + sd_tol)
    cons.append(w @ spread_dur >= bmk_sd - sd_tol)
    info.append({"name": "Spread duration", "bound": sd_tol})

    # (5) Tracking error cap
    max_te = constraints.get("max_tracking_error", 150.0) / 10000.0
    active = w - w_mkt
    cons.append(cp.quad_form(active, cov_psd) <= max_te ** 2)
    info.append({"name": "Tracking error", "bound": max_te * 10000})

    # --- Solve ---
    prob = cp.Problem(objective, cons)
    solver_status = "optimal"
    try:
        prob.solve(solver=cp.SCS, verbose=False, max_iters=10000, eps=1e-8)
        if prob.status not in ("optimal", "optimal_inaccurate"):
            prob.solve(solver=cp.ECOS, verbose=False)  # fallback solver
        solver_status = prob.status
    except Exception as e:
        solver_status = f"error: {e}"

    # --- Extract weights ---
    if w.value is not None:
        weights = np.maximum(np.array(w.value).flatten(), 0)
        weights /= weights.sum()
    else:
        weights = w_mkt.copy()  # fallback to benchmark
        solver_status = "infeasible_fallback_to_benchmark"

    binding = [{**ci, "value": 0.0, "active": False, "shadow_price": None} for ci in info]
    return weights, solver_status, binding
