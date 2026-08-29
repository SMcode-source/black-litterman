"""
Black-Litterman Model implementation
Combines market implied returns with investor views to create optimal portfolio weights
"""

import numpy as np
import pandas as pd
from scipy.optimize import minimize
import warnings

warnings.filterwarnings('ignore')


class BlackLittermanModel:
    """
    Black-Litterman Model for portfolio optimization
    
    The Black-Litterman model combines:
    1. Market implied returns (from market equilibrium)
    2. Investor views (subjective beliefs)
    3. Bayesian framework to combine prior and views
    """
    
    def __init__(self, market_weights, cov_matrix, risk_free_rate, market_risk_premium, tau=0.05):
        """
        Initialize Black-Litterman Model
        
        Parameters:
        -----------
        market_weights : pd.Series
            Market capitalization weights of assets
        cov_matrix : pd.DataFrame
            Covariance matrix of asset returns (annualized)
        risk_free_rate : float
            Risk-free rate (annual)
        market_risk_premium : float
            Market risk premium (annual)
        tau : float
            Scalar controlling uncertainty of prior (typically 0.01-0.05)
        """
        self.market_weights = market_weights
        self.cov_matrix = cov_matrix
        self.risk_free_rate = risk_free_rate
        self.market_risk_premium = market_risk_premium
        self.tau = tau
        
        # Align covariance matrix with market weights
        common_assets = market_weights.index.intersection(cov_matrix.index)
        self.market_weights = market_weights[common_assets]
        self.cov_matrix = cov_matrix.loc[common_assets, common_assets]
        
        # Initialize model outputs
        self.market_implied_returns = None
        self.posterior_returns = None
        self.posterior_cov = None
        self.optimal_weights = None
        self.views = None
        self.view_confidence = None
        self.P = None  # View matrix
        self.q = None  # View returns
        
    def calculate_market_implied_returns(self):
        """
        Calculate market implied returns using reverse optimization
        
        Uses the equilibrium assumption: if market weights are optimal,
        we can reverse-engineer the expected returns that would lead to
        those weights using CAPM framework.
        
        Returns:
        --------
        pd.Series
            Implied returns for each asset
        """
        # Calculate variance of market portfolio
        market_variance = np.dot(
            self.market_weights.values,
            np.dot(self.cov_matrix.values, self.market_weights.values)
        )
        
        # Calculate risk contributions (covariance with market)
        risk_contributions = np.dot(self.cov_matrix.values, self.market_weights.values)
        
        # Calculate implied returns using CAPM
        # Beta = Cov(i, Market) / Var(Market)
        betas = risk_contributions / market_variance
        
        # Implied return = Rf + Beta * Market Risk Premium
        self.market_implied_returns = pd.Series(
            self.risk_free_rate + betas * self.market_risk_premium,
            index=self.market_weights.index
        )
        
        return self.market_implied_returns
    
    def add_view(self, asset_view_map, confidence=0.95):
        """
        Add investor views to the model
        
        Parameters:
        -----------
        asset_view_map : dict
            Dictionary mapping asset ticker to expected return
            Example: {'AAPL': 0.15, 'MSFT': 0.12}
        confidence : float
            Confidence in the views (0-1), where 1 = 100% confident
            
        Returns:
        --------
        self
        """
        self.views = asset_view_map
        self.view_confidence = confidence
        
        # Create view matrix P (maps assets to views)
        view_assets = [asset for asset in asset_view_map.keys() if asset in self.market_weights.index]
        n_views = len(view_assets)
        n_assets = len(self.market_weights)
        
        if n_views == 0:
            raise ValueError("No valid assets found in views that match market weights")
        
        self.P = np.zeros((n_views, n_assets))
        self.q = np.array([asset_view_map[asset] for asset in view_assets])
        
        asset_list = list(self.market_weights.index)
        for i, asset in enumerate(view_assets):
            asset_idx = asset_list.index(asset)
            self.P[i, asset_idx] = 1.0
        
        return self
    
    def update_posterior(self):
        """
        Calculate posterior returns and covariance using Bayesian framework
        
        Combines prior (market implied returns) with views using:
        - Prior: Market implied returns with uncertainty tau * Sigma
        - Views: Investor beliefs with uncertainty Omega
        - Posterior: Weighted combination based on confidence
        
        Returns:
        --------
        pd.Series
            Posterior expected returns
        """
        if self.market_implied_returns is None:
            self.calculate_market_implied_returns()
        
        if self.P is None or self.q is None:
            # No views: posterior = prior
            self.posterior_returns = self.market_implied_returns.copy()
            self.posterior_cov = self.cov_matrix.values.copy()
            return self.posterior_returns
        
        # Convert to numpy arrays for computation
        cov = self.cov_matrix.values
        P = self.P
        q = self.q
        mu = self.market_implied_returns.values
        
        # Calculate view uncertainty matrix Omega
        # Higher confidence = lower uncertainty in views
        view_var = np.diag(P @ cov @ P.T)  # Variance of each view
        confidence_ratio = self.view_confidence
        omega = np.diag(view_var * (1 - confidence_ratio) / confidence_ratio)
        
        # Ensure omega is invertible (add small diagonal for numerical stability)
        omega = omega + np.eye(len(omega)) * 1e-8
        
        # Black-Litterman posterior return formula
        # E[R] = mu + tau*Sigma*P' * (Omega + tau*P*Sigma*P')^-1 * (q - P*mu)
        tau_cov = self.tau * cov
        temp = np.linalg.inv(omega + P @ tau_cov @ P.T)
        self.posterior_returns = mu + (tau_cov @ P.T @ temp @ (q - P @ mu))
        
        self.posterior_returns = pd.Series(
            self.posterior_returns,
            index=self.market_weights.index
        )
        
        # Posterior covariance (typically close to original in practice)
        # For stability, we keep the original covariance
        self.posterior_cov = cov
        
        return self.posterior_returns
    
    def optimize_portfolio(self, min_weight=0.0, max_weight=0.1, risk_aversion=2.0):
        """
        Optimize portfolio weights using posterior expected returns and covariance
        
        Maximizes: E[Return] - (risk_aversion/2) * Variance
        Subject to: sum(weights) = 1, min_weight <= weight <= max_weight
        
        Parameters:
        -----------
        min_weight : float
            Minimum weight per asset (0 = no shorting)
        max_weight : float
            Maximum weight per asset (0.1 = 10% max per stock)
        risk_aversion : float
            Risk aversion parameter (higher = more risk averse)
            
        Returns:
        --------
        pd.Series
            Optimal portfolio weights
        """
        if self.posterior_returns is None:
            self.update_posterior()
        
        n_assets = len(self.market_weights)
        
        # Objective: maximize Sharpe-like ratio
        # Minimize: -E[Return] + (risk_aversion/2) * Variance
        def objective(w):
            portfolio_return = np.dot(w, self.posterior_returns.values)
            portfolio_variance = np.dot(w, np.dot(self.posterior_cov, w))
            return -portfolio_return + (risk_aversion / 2) * portfolio_variance
        
        # Constraints: weights sum to 1
        constraints = {'type': 'eq', 'fun': lambda w: np.sum(w) - 1}
        
        # Bounds for weights
        bounds = tuple((min_weight, max_weight) for _ in range(n_assets))
        
        # Initial guess: market weights
        x0 = self.market_weights.values.copy()
        
        # Optimize using SLSQP
        result = minimize(
            objective,
            x0,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints,
            options={'ftol': 1e-9, 'maxiter': 1000}
        )
        
        if not result.success:
            print(f"Warning: Optimization did not converge: {result.message}")
        
        # Normalize weights to ensure they sum to exactly 1.0
        # This handles numerical precision issues
        weights = result.x
        weights = np.maximum(weights, min_weight)  # Ensure >= min_weight
        weights = np.minimum(weights, max_weight)  # Ensure <= max_weight
        weights = weights / weights.sum()  # Normalize to sum to 1.0
        
        # Verify sum is 1.0 (within numerical precision)
        weight_sum = weights.sum()
        if abs(weight_sum - 1.0) > 1e-6:
            print(f"Warning: Weights sum to {weight_sum:.6f}, normalizing to 1.0")
            weights = weights / weight_sum
        
        self.optimal_weights = pd.Series(
            weights,
            index=self.market_weights.index
        ).sort_values(ascending=False)
        
        return self.optimal_weights
    
    def get_portfolio_statistics(self, weights=None):
        """
        Calculate portfolio statistics
        
        Parameters:
        -----------
        weights : pd.Series, optional
            Portfolio weights (default: optimal weights)
            
        Returns:
        --------
        dict
            Dictionary with return, volatility, Sharpe ratio, variance
        """
        if weights is None:
            weights = self.optimal_weights
        
        if weights is None:
            weights = self.market_weights
        
        returns = self.posterior_returns if self.posterior_returns is not None else self.market_implied_returns
        cov = self.posterior_cov if self.posterior_cov is not None else self.cov_matrix.values
        
        portfolio_return = np.dot(weights.values, returns.values)
        portfolio_variance = np.dot(weights.values, np.dot(cov, weights.values))
        portfolio_std = np.sqrt(portfolio_variance)
        sharpe_ratio = (portfolio_return - self.risk_free_rate) / portfolio_std if portfolio_std > 0 else 0
        
        return {
            'return': portfolio_return,
            'volatility': portfolio_std,
            'sharpe_ratio': sharpe_ratio,
            'variance': portfolio_variance
        }
    
    def compare_portfolios(self):
        """
        Compare market-cap weighted, Black-Litterman (no views), and optimal portfolios
        
        Returns:
        --------
        pd.DataFrame
            Comparison statistics for each portfolio
        """
        stats = {}
        
        # Market portfolio stats
        stats['Market Cap Weighted'] = self.get_portfolio_statistics(self.market_weights)
        
        # Black-Litterman without views (uses implied returns)
        if self.market_implied_returns is not None:
            # Temporarily override posterior with implied returns for comparison
            posterior_backup = self.posterior_returns.copy() if self.posterior_returns is not None else None
            self.posterior_returns = self.market_implied_returns.copy()
            self.posterior_cov = self.cov_matrix.values.copy()
            stats['BL (No Views)'] = self.get_portfolio_statistics(self.market_weights)
            
            # Restore posterior if it was set
            if posterior_backup is not None:
                self.posterior_returns = posterior_backup
        
        # Black-Litterman with views (optimal portfolio)
        if self.optimal_weights is not None and self.posterior_returns is not None:
            stats['BL with Views'] = self.get_portfolio_statistics(self.optimal_weights)
        
        return pd.DataFrame(stats).T


def create_default_views(market_implied_returns, percentile=75, multiplier=1.2):
    """
    Create default views based on top performers
    
    Selects assets above a percentile of implied returns and applies
    a multiplier to create optimistic views.
    
    Parameters:
    -----------
    market_implied_returns : pd.Series
        Market implied returns
    percentile : float
        Percentile threshold (e.g., 75 = top 25%)
    multiplier : float
        Multiplier for optimistic views (e.g., 1.2 = 20% more optimistic)
        
    Returns:
    --------
    dict
        Dictionary mapping asset to expected return
    """
    threshold = market_implied_returns.quantile(percentile / 100)
    top_assets = market_implied_returns[market_implied_returns > threshold]
    
    views = {
        asset: return_val * multiplier
        for asset, return_val in top_assets.items()
    }
    
    return views
