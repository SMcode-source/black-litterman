"""
Main script to run Black-Litterman Model for S&P 500 stocks
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import os
import warnings

from data_fetcher import prepare_market_data
from black_litterman_model import BlackLittermanModel, create_default_views
import config

warnings.filterwarnings('ignore')


def main():
    """
    Main execution function
    """
    print("=" * 80)
    print("BLACK-LITTERMAN MODEL FOR S&P 500 STOCKS")
    print("=" * 80)
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Step 1: Prepare market data
    print("STEP 1: Fetching S&P 500 Market Data from Yahoo Finance...")
    print("-" * 80)
    print("Note: Yahoo Finance API (no rate limits)\n")
    
    try:
        fetcher, market_weights, cov_matrix, returns = prepare_market_data(
            config.DATA_START_DATE,
            config.DATA_END_DATE,
            use_cache=True  # Use cached data if available
        )
    except Exception as e:
        print(f"\n[ERROR] Error fetching data: {e}")
        return None
    
    # Step 2: Initialize Black-Litterman Model
    print("\n" + "=" * 80)
    print("STEP 2: Initializing Black-Litterman Model...")
    print("-" * 80)
    
    bl_model = BlackLittermanModel(
        market_weights=market_weights,
        cov_matrix=cov_matrix,
        risk_free_rate=config.RISK_FREE_RATE,
        market_risk_premium=config.MARKET_RISK_PREMIUM,
        tau=config.TAU
    )
    
    print(f"Model initialized with {len(market_weights)} assets")
    
    # Step 3: Calculate market implied returns
    print("\nSTEP 3: Calculating Market Implied Returns...")
    print("-" * 80)
    
    implied_returns = bl_model.calculate_market_implied_returns()
    
    print(f"\nTop {config.TOP_N_STOCKS} Market Implied Returns:")
    print(implied_returns.sort_values(ascending=False).head(config.TOP_N_STOCKS).to_string())
    print(f"\nBottom 10 Market Implied Returns:")
    print(implied_returns.sort_values(ascending=True).head(10).to_string())
    
    # Step 4: Add investor views
    print("\nSTEP 4: Creating Investor Views...")
    print("-" * 80)
    
    # Create default views (optimistic on top performers)
    views = create_default_views(implied_returns, percentile=75, multiplier=1.2)
    print(f"\nCreated {len(views)} investor views (top 25% performers, 20% optimistic)")
    print("Sample views:")
    for asset, return_val in list(views.items())[:10]:
        print(f"  {asset}: {return_val:.2%}")
    
    bl_model.add_view(views, confidence=config.CONFIDENCE)
    
    # Step 5: Update posterior returns
    print("\nSTEP 5: Updating Posterior Returns with Views...")
    print("-" * 80)
    
    posterior_returns = bl_model.update_posterior()
    
    print(f"\nTop {config.TOP_N_STOCKS} Posterior Returns (after incorporating views):")
    print(posterior_returns.sort_values(ascending=False).head(config.TOP_N_STOCKS).to_string())
    
    # Step 6: Optimize portfolio
    print("\nSTEP 6: Optimizing Portfolio Weights...")
    print("-" * 80)
    
    optimal_weights = bl_model.optimize_portfolio(
        min_weight=config.MIN_WEIGHT,
        max_weight=config.MAX_WEIGHT
    )
    
    print(f"\nTop {config.TOP_N_STOCKS} Optimal Portfolio Weights:")
    print(optimal_weights.head(config.TOP_N_STOCKS).to_string())
    print(f"\nPortfolio Statistics:")
    print(f"  - Number of positions: {(optimal_weights > 0.001).sum()}")
    print(f"  - Concentration (top 10): {optimal_weights.head(10).sum():.2%}")
    print(f"  - Concentration (top 20): {optimal_weights.head(20).sum():.2%}")
    
    # Step 7: Compare portfolios
    print("\nSTEP 7: Portfolio Statistics Comparison...")
    print("-" * 80)
    
    comparison = bl_model.compare_portfolios()
    print("\nPortfolio Comparison:")
    print(comparison.round(4))
    
    # Step 8: Save results
    print("\nSTEP 8: Saving Results...")
    print("-" * 80)
    
    results_dir = "./results"
    os.makedirs(results_dir, exist_ok=True)
    
    # Save weights
    weights_df = pd.DataFrame({
        'Market Cap Weight': market_weights.reindex(optimal_weights.index).fillna(0),
        'Optimal BL Weight': optimal_weights
    }).sort_values('Optimal BL Weight', ascending=False)
    
    weights_file = f"{results_dir}/optimal_weights.csv"
    weights_df.to_csv(weights_file, index=True)
    print(f"[OK] Saved optimal weights to: {weights_file}")
    print(f"      ({len(weights_df)} stocks)")
    
    # Save returns
    returns_df = pd.DataFrame({
        'Market Implied Returns': implied_returns.reindex(optimal_weights.index).fillna(0),
        'Posterior Returns': posterior_returns.reindex(optimal_weights.index).fillna(0)
    }).sort_values('Posterior Returns', ascending=False)
    
    returns_file = f"{results_dir}/implied_posterior_returns.csv"
    returns_df.to_csv(returns_file, index=True)
    print(f"[OK] Saved returns to: {returns_file}")
    print(f"      ({len(returns_df)} stocks)")
    
    # Save statistics
    stats_file = f"{results_dir}/portfolio_statistics.csv"
    comparison.to_csv(stats_file, index=True)
    print(f"[OK] Saved portfolio statistics to: {stats_file}")
    
    # Save raw price data (for reference)
    price_data_file = f"{results_dir}/price_data.csv"
    fetcher.price_data.to_csv(price_data_file)
    print(f"[OK] Saved price data to: {price_data_file}")
    print(f"      ({len(fetcher.price_data.columns)} stocks, {len(fetcher.price_data)} dates)")
    
    # Save market cap data
    market_caps_file = f"{results_dir}/market_caps.csv"
    market_caps_df = pd.DataFrame({
        'Market Cap (Billions)': fetcher.market_caps / 1e9,
        'Market Cap (Raw)': fetcher.market_caps
    }).sort_values('Market Cap (Raw)', ascending=False)
    market_caps_df.to_csv(market_caps_file, index=True)
    print(f"[OK] Saved market cap data to: {market_caps_file}")
    print(f"      ({len(market_caps_df)} stocks)")
    
    # Save returns data
    returns_data_file = f"{results_dir}/returns_data.csv"
    returns_data = fetcher.get_returns()
    returns_data.to_csv(returns_data_file)
    print(f"[OK] Saved returns data to: {returns_data_file}")
    print(f"      ({len(returns_data.columns)} stocks, {len(returns_data)} trading days)")
    
    # Save covariance matrix
    cov_file = f"{results_dir}/covariance_matrix.csv"
    cov_matrix.to_csv(cov_file)
    print(f"[OK] Saved covariance matrix to: {cov_file}")
    print(f"      ({cov_matrix.shape[0]} x {cov_matrix.shape[1]})")
    
    # Step 9: Generate visualizations
    if config.PLOT_RESULTS:
        print("\nSTEP 9: Generating Visualizations...")
        print("-" * 80)
        
        generate_plots(implied_returns, posterior_returns, optimal_weights, market_weights, results_dir)
        
        print(f"[OK] Visualizations saved to: {results_dir}/")
    
    print("\n" + "=" * 80)
    print("BLACK-LITTERMAN MODEL EXECUTION COMPLETED")
    print("=" * 80)
    
    return bl_model, comparison, weights_df, returns_df


def generate_plots(implied_returns, posterior_returns, optimal_weights, market_weights, results_dir):
    """
    Generate visualization plots
    """
    # Set style
    sns.set_style("whitegrid")
    plt.rcParams['figure.figsize'] = (18, 12)
    
    fig = plt.figure(figsize=(20, 14))
    
    # Plot 1: Implied vs Posterior Returns (Top 30)
    ax1 = plt.subplot(2, 3, 1)
    top_assets = posterior_returns.abs().nlargest(30).index
    comparison_returns = pd.DataFrame({
        'Implied': implied_returns[top_assets],
        'Posterior': posterior_returns[top_assets]
    }).sort_values('Posterior', ascending=True)
    
    comparison_returns.plot(kind='barh', ax=ax1, width=0.8)
    ax1.set_title('Implied vs Posterior Returns (Top 30 Assets)', fontsize=12, fontweight='bold')
    ax1.set_xlabel('Expected Return')
    ax1.legend(loc='lower right')
    ax1.grid(True, alpha=0.3)
    
    # Plot 2: Return Distribution
    ax2 = plt.subplot(2, 3, 2)
    ax2.hist(implied_returns.values, bins=40, alpha=0.6, label='Implied Returns', color='blue', edgecolor='black')
    ax2.hist(posterior_returns.values, bins=40, alpha=0.6, label='Posterior Returns', color='red', edgecolor='black')
    ax2.set_xlabel('Expected Return')
    ax2.set_ylabel('Frequency')
    ax2.set_title('Distribution of Expected Returns', fontsize=12, fontweight='bold')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    # Plot 3: Optimal vs Market Weights (Top 30)
    ax3 = plt.subplot(2, 3, 3)
    top_weights_idx = optimal_weights.nlargest(30).index
    weight_comparison = pd.DataFrame({
        'Market Cap': market_weights.reindex(top_weights_idx).fillna(0),
        'Optimal BL': optimal_weights[top_weights_idx]
    }).sort_values('Optimal BL', ascending=True)
    
    weight_comparison.plot(kind='barh', ax=ax3, width=0.8)
    ax3.set_title('Market Cap vs BL Optimal Weights (Top 30)', fontsize=12, fontweight='bold')
    ax3.set_xlabel('Weight')
    ax3.legend(loc='lower right')
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Weight Distribution
    ax4 = plt.subplot(2, 3, 4)
    market_nonzero = market_weights[market_weights > 0.001].values * 100
    optimal_nonzero = optimal_weights[optimal_weights > 0.001].values * 100
    ax4.hist(market_nonzero, bins=50, alpha=0.6, label='Market Weights', color='green', edgecolor='black')
    ax4.hist(optimal_nonzero, bins=50, alpha=0.6, label='Optimal BL Weights', color='orange', edgecolor='black')
    ax4.set_xlabel('Weight (%)')
    ax4.set_ylabel('Frequency')
    ax4.set_title('Distribution of Portfolio Weights', fontsize=12, fontweight='bold')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    
    # Plot 5: Cumulative Weight (Concentration)
    ax5 = plt.subplot(2, 3, 5)
    market_cumsum = market_weights.sort_values(ascending=False).cumsum() * 100
    bl_cumsum = optimal_weights.sort_values(ascending=False).cumsum() * 100
    
    ax5.plot(range(len(market_cumsum)), market_cumsum.values, 'o-', label='Market Cap', alpha=0.7, markersize=3)
    ax5.plot(range(len(bl_cumsum)), bl_cumsum.values, 's-', label='Optimal BL', alpha=0.7, markersize=3)
    ax5.axhline(y=80, color='r', linestyle='--', alpha=0.5, label='80% Threshold')
    ax5.set_xlabel('Number of Assets')
    ax5.set_ylabel('Cumulative Weight (%)')
    ax5.set_title('Portfolio Concentration Analysis', fontsize=12, fontweight='bold')
    ax5.legend()
    ax5.grid(True, alpha=0.3)
    
    # Plot 6: Weight Difference
    ax6 = plt.subplot(2, 3, 6)
    weight_diff = (optimal_weights - market_weights.reindex(optimal_weights.index).fillna(0)).sort_values()
    top_diff = weight_diff.head(20)
    colors = ['red' if x < 0 else 'green' for x in top_diff.values]
    
    ax6.barh(range(len(top_diff)), top_diff.values, color=colors)
    ax6.set_yticks(range(len(top_diff)))
    ax6.set_yticklabels(top_diff.index, fontsize=9)
    ax6.set_xlabel('Weight Change (BL - Market Cap)')
    ax6.set_title('Top 20 Weight Changes', fontsize=12, fontweight='bold')
    ax6.grid(True, alpha=0.3, axis='x')
    ax6.axvline(x=0, color='black', linestyle='-', linewidth=0.5)
    
    plt.tight_layout()
    plt.savefig(f'{results_dir}/bl_analysis.png', dpi=300, bbox_inches='tight')
    print("[OK] Saved analysis plot: bl_analysis.png")
    
    plt.close()


if __name__ == "__main__":
    try:
        bl_model, comparison, weights_df, returns_df = main()
    except KeyboardInterrupt:
        print("\n\n[INFO] Execution interrupted by user.")
    except Exception as e:
        print(f"\n\n[ERROR] Error during execution: {e}")
        import traceback
        traceback.print_exc()
