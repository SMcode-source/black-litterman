# Black-Litterman Model for S&P 500 Stocks

> This is the **original standalone batch model** — the Python pipeline the equity side of the
> project grew out of. It runs offline and writes CSVs plus a matplotlib chart.
>
> For the interactive version, see the app at
> [smcode-source.github.io/black-litterman](https://smcode-source.github.io/black-litterman/),
> built from [`app/`](../app) with its data snapshot from [`data-pipeline/`](../data-pipeline).
> The two are independent: this one keeps its own cache, its own config, and its own outputs,
> and nothing here runs at deploy time.

A comprehensive implementation of the Black-Litterman portfolio optimization model for all S&P 500 stocks using Yahoo Finance API.

## Overview

The Black-Litterman Model combines:
- **Market Implied Returns**: Derived from current market equilibrium using reverse optimization
- **Investor Views**: Subjective beliefs about expected returns
- **Bayesian Framework**: Sophisticated weighting of prior beliefs and new information

This implementation provides:
- ✅ Complete S&P 500 stock coverage (~500 stocks)
- ✅ Market-cap weighted portfolio construction
- ✅ Implied returns calculation from market data
- ✅ Posterior return estimation with investor views
- ✅ Portfolio optimization with constraints
- ✅ Comprehensive performance analysis and visualizations
- ✅ **Data caching** to avoid re-fetching from API
- ✅ **Complete CSV exports** of all results and raw data

## Requirements

Install dependencies:
```bash
pip install -r requirements.txt
```

Required packages:
- numpy>=1.21.0
- pandas>=1.3.0
- scipy>=1.7.0
- yfinance>=0.2.0
- matplotlib>=3.4.0
- seaborn>=0.11.0

## Project Structure

```
equity/
├── main.py                      # Main execution script
├── black_litterman_model.py     # BL model implementation
├── data_fetcher.py              # Yahoo Finance data fetching (with caching)
├── config.py                    # Configuration parameters
├── requirements.txt             # Python dependencies
├── SP500 Tickers.txt            # Ticker universe (input to data_fetcher)
├── README.md                    # This file
├── market_implied_returns/      # Standalone market-implied-return outputs
├── cache/                       # Cached API data (auto-created, gitignored)
│   ├── price_data_cache.pkl    # Cached price data
│   └── market_caps_cache.pkl   # Cached market cap data
├── raw_data/                    # Raw API exports (auto-created, gitignored)
└── results/                     # Output directory (auto-created, gitignored)
    ├── optimal_weights.csv      # Optimal portfolio weights
    ├── implied_posterior_returns.csv  # Return comparisons
    ├── portfolio_statistics.csv # Portfolio metrics
    ├── price_data.csv           # Raw price data
    ├── market_caps.csv          # Market capitalization data
    ├── returns_data.csv         # Daily returns data
    ├── covariance_matrix.csv    # Covariance matrix
    └── bl_analysis.png          # Visualization plots
```

## Configuration

Edit `config.py` to customize model parameters:

```python
RISK_FREE_RATE = 0.04            # Risk-free rate (4%)
MARKET_RISK_PREMIUM = 0.05       # Market risk premium (5%)
DATA_START_DATE = "2020-01-01"   # Fetch window, start
DATA_END_DATE = "2025-12-31"     # Fetch window, end
TAU = 0.05                        # Prior uncertainty parameter
CONFIDENCE = 0.95                 # Confidence in investor views
MIN_WEIGHT = 0.0                  # Minimum asset weight
MAX_WEIGHT = 0.1                  # Maximum asset weight (10%)
TOP_N_STOCKS = 50                 # How many stocks to print in the results table
OUTPUT_RESULTS = True             # Write CSVs to results/
PLOT_RESULTS = True               # Write bl_analysis.png
```

**The fetch window is a fixed date range, not a rolling one.** `DATA_END_DATE` is hard-coded, so
the model silently stops at that date however long after it you run — push it forward before
reading anything into a run as "current". The app in `app/` has no such problem; its snapshot
is refetched to the previous close on every deploy.

**Paths are relative to the working directory, not the script.** `cache/`, `raw_data/` and
`results/` are created wherever you invoke `python main.py` from, so run it from inside
`equity/` or the output lands somewhere you did not intend.

## Usage

Run the full pipeline over all S&P 500 stocks:

```bash
python main.py
```

### Important Notes

**Yahoo Finance API**: 
- No API key required
- No rate limits
- Fast data fetching for all S&P 500 stocks
- **Estimated time**: ~5-10 minutes to fetch all S&P 500 stocks (first run only)

**Data Caching**: 
- Data is automatically cached in the `cache/` directory
- Subsequent runs will use cached data (no API calls needed)
- Cache is invalidated if tickers or date range changes
- To force re-fetch, delete the `cache/` directory

**Raw Data Storage**:
- All raw API data is saved to CSV files in the `raw_data/` directory
- Files include: price data, market caps, returns, and covariance matrix
- Each CSV has appropriate headers for easy inspection

The script will:
1. Check for cached data (if available, skips API calls)
2. Fetch S&P 500 stock list
3. Download historical price data (saves to `raw_data/raw_price_data.csv`)
4. Download market cap data (saves to `raw_data/raw_market_caps.csv`)
5. Calculate returns and covariance (saves to `raw_data/raw_returns_data.csv` and `raw_data/raw_covariance_matrix.csv`)
6. Calculate market implied returns
7. Create investor views
8. Calculate posterior returns
9. Optimize portfolio weights
10. Generate visualizations and save all results to CSV files

## Output Files

### Results Directory (`results/`)
All analysis results are saved here:

1. **optimal_weights.csv**: Portfolio weights for each stock
   - Market Cap Weight
   - Optimal BL Weight

2. **implied_posterior_returns.csv**: Comparison of returns
   - Market Implied Returns
   - Posterior Returns (after views)

3. **portfolio_statistics.csv**: Performance metrics
   - Return, Volatility, Sharpe Ratio, Variance
   - For Market Cap Weighted, BL (No Views), and BL with Views

4. **price_data.csv**: Processed historical price data
   - All stocks, all dates

5. **market_caps.csv**: Market capitalization data
   - Market Cap in Billions and Raw values

6. **returns_data.csv**: Daily returns data
   - Log returns for all stocks

7. **covariance_matrix.csv**: Annualized covariance matrix
   - Full covariance matrix for portfolio optimization

8. **bl_analysis.png**: Comprehensive visualization with 6 plots

### Raw Data Directory (`raw_data/`)
All raw API data is saved here with appropriate headers:

1. **raw_price_data.csv**: Raw price data from Yahoo Finance
   - Date index, Close prices for each stock
   - Headers: Date, [Stock Tickers]

2. **raw_market_caps.csv**: Raw market capitalization data
   - Headers: Ticker, Market Cap (Raw), Market Cap (Billions)

3. **raw_returns_data.csv**: Raw daily log returns
   - Date index, Returns for each stock
   - Headers: Date, [Stock Tickers]

4. **raw_covariance_matrix.csv**: Raw annualized covariance matrix
   - Headers: [Stock Tickers] (both rows and columns)

## How It Works

### 1. Market Implied Returns
Uses reverse optimization to derive expected returns that would lead to current market-cap weights, assuming market equilibrium.

### 2. Investor Views
Creates views on top-performing stocks (top 25% by implied returns) with 20% optimistic adjustment.

### 3. Posterior Returns
Combines market implied returns (prior) with investor views using Bayesian framework:
- Higher confidence = views have more weight
- Lower confidence = market equilibrium has more weight

### 4. Portfolio Optimization
Maximizes risk-adjusted returns subject to:
- Weights sum to 1
- No shorting (min_weight = 0)
- Maximum 10% per stock (max_weight = 0.1)

## Data Caching

The system automatically caches API responses to avoid re-fetching:

- **Cache location**: `cache/` directory
- **Cache files**: 
  - `price_data_cache.pkl` - Cached price data
  - `market_caps_cache.pkl` - Cached market cap data
- **Cache invalidation**: Automatically invalidated if:
  - Ticker list changes
  - Date range changes
- **Force refresh**: Delete `cache/` directory to force re-fetch

## Model Parameters

- **tau (τ)**: Controls uncertainty of prior (typically 0.01-0.05)
  - Lower = more confident in market equilibrium
  - Higher = less confident, views matter more

- **Confidence**: Investor confidence in views (0-1)
  - 0.95 = 95% confident in views
  - Higher confidence = lower uncertainty in views

- **Risk Aversion**: Controls risk-return tradeoff
  - Higher = more risk averse
  - Lower = more aggressive

## Limitations

- Historical data availability depends on Yahoo Finance
- Market cap data may be estimated for some stocks if not available
- Model assumes normal distribution of returns
- Some stocks may not have complete historical data

## References

- Black, F., & Litterman, R. (1992). Global portfolio optimization. Financial Analysts Journal, 48(5), 28-43.
- He, G., & Litterman, R. (1999). The intuition behind Black-Litterman model portfolios.

## License

This project is provided as-is for educational and research purposes.
