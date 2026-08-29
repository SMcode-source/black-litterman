"""
Data fetcher module using Yahoo Finance API for S&P 500 stocks
Fetches historical price data and market cap information
Caches data to avoid re-fetching on subsequent runs
Saves raw data to CSV files with appropriate headers
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime
import os
import pickle
import warnings

warnings.filterwarnings('ignore')


class YahooFinanceDataFetcher:
    """Fetches S&P 500 constituent stocks data from Yahoo Finance"""
    
    def __init__(self, start_date, end_date, cache_dir="./cache", raw_data_dir="./raw_data"):
        self.start_date = pd.Timestamp(start_date)
        self.end_date = pd.Timestamp(end_date)
        self.tickers = []
        self.price_data = None
        self.market_caps = None
        self.cache_dir = cache_dir
        self.raw_data_dir = raw_data_dir
        os.makedirs(cache_dir, exist_ok=True)
        os.makedirs(raw_data_dir, exist_ok=True)
        
    def get_sp500_constituents(self, ticker_file="SP500 Tickers.txt"):
        """
        Get list of S&P 500 constituent stocks from file
        Returns the list of stocks from the ticker file
        """
        ticker_path = os.path.join(os.path.dirname(__file__), ticker_file)
        
        if not os.path.exists(ticker_path):
            raise FileNotFoundError(f"Ticker file not found: {ticker_path}")
        
        try:
            with open(ticker_path, 'r') as f:
                # Read all lines, strip whitespace, filter out empty lines
                tickers = [line.strip() for line in f.readlines() if line.strip()]
            
            # Remove duplicates and sort
            self.tickers = sorted(list(set(tickers)))
            print(f"Loaded {len(self.tickers)} S&P 500 stocks from {ticker_file}")
            
            return self.tickers
        except Exception as e:
            raise ValueError(f"Error reading ticker file {ticker_path}: {e}")
    
    def _get_cache_file(self, data_type):
        """Get cache file path for a data type"""
        cache_file = os.path.join(self.cache_dir, f"{data_type}_cache.pkl")
        return cache_file
    
    def _load_cached_data(self, data_type):
        """Load cached data if available"""
        cache_file = self._get_cache_file(data_type)
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'rb') as f:
                    cached = pickle.load(f)
                    # Check if cache is still valid (same tickers and date range)
                    if (cached.get('tickers') == self.tickers and 
                        cached.get('start_date') == self.start_date and
                        cached.get('end_date') == self.end_date):
                        print(f"[CACHE] Found cached {data_type} data")
                        return cached.get('data')
                    else:
                        print(f"[CACHE] Cached {data_type} data outdated, will re-fetch")
            except Exception as e:
                print(f"[CACHE] Error loading cached {data_type}: {e}")
        return None
    
    def _save_cached_data(self, data_type, data):
        """Save data to cache"""
        cache_file = self._get_cache_file(data_type)
        try:
            cache_data = {
                'data': data,
                'tickers': self.tickers,
                'start_date': self.start_date,
                'end_date': self.end_date,
                'cached_at': datetime.now()
            }
            with open(cache_file, 'wb') as f:
                pickle.dump(cache_data, f)
            print(f"[CACHE] Saved {data_type} data to cache")
        except Exception as e:
            print(f"[CACHE] Error saving {data_type} to cache: {e}")
    
    def _save_raw_data_to_csv(self, data, filename, description):
        """Save raw data to CSV with appropriate headers"""
        filepath = os.path.join(self.raw_data_dir, filename)
        try:
            if isinstance(data, pd.DataFrame):
                data.to_csv(filepath, index=True)
            elif isinstance(data, pd.Series):
                data.to_frame().to_csv(filepath, index=True)
            else:
                # Convert to DataFrame if needed
                pd.DataFrame(data).to_csv(filepath, index=True)
            print(f"[RAW DATA] Saved {description} to: {filepath}")
        except Exception as e:
            print(f"[RAW DATA] Error saving {description}: {e}")
    
    def fetch_price_data(self, use_cache=True):
        """
        Fetch historical price data for stocks from Yahoo Finance
        Saves raw data to CSV files
        """
        if not self.tickers:
            self.get_sp500_constituents()
        
        # Try to load from cache first
        if use_cache:
            cached_data = self._load_cached_data('price_data')
            if cached_data is not None:
                self.price_data = cached_data
                print(f"[CACHE] Loaded price data: {len(self.price_data.columns)} stocks, {len(self.price_data)} dates")
                # Still save to CSV even if from cache
                self._save_raw_data_to_csv(
                    self.price_data, 
                    'raw_price_data.csv',
                    'Raw price data (from cache)'
                )
                return self.price_data
        
        print(f"Downloading price data from Yahoo Finance...")
        print(f"Date range: {self.start_date.date()} to {self.end_date.date()}")
        print(f"Fetching {len(self.tickers)} stocks...\n")
        
        price_data_dict = {}
        successful = 0
        failed = 0
        
        # Fetch data in batches to avoid overwhelming the API
        batch_size = 50
        for batch_start in range(0, len(self.tickers), batch_size):
            batch_end = min(batch_start + batch_size, len(self.tickers))
            batch_tickers = self.tickers[batch_start:batch_end]
            
            print(f"Fetching batch {batch_start//batch_size + 1}/{(len(self.tickers)-1)//batch_size + 1} "
                  f"({batch_start+1}-{batch_end} of {len(self.tickers)})...", end=" ", flush=True)
            
            try:
                # Download data for batch
                ticker_string = ' '.join(batch_tickers)
                tickers_obj = yf.Tickers(ticker_string)
                
                for ticker in batch_tickers:
                    try:
                        ticker_obj = yf.Ticker(ticker)
                        hist = ticker_obj.history(start=self.start_date, end=self.end_date, auto_adjust=True)
                        
                        if hist is not None and len(hist) > 0:
                            # Use Close price
                            prices = hist['Close']
                            if len(prices) >= 60:  # Minimum 60 days
                                price_data_dict[ticker] = prices
                                successful += 1
                            else:
                                failed += 1
                        else:
                            failed += 1
                    except Exception as e:
                        failed += 1
                        continue
                
                print(f"[OK] {successful} successful, {failed} failed so far")
                
            except Exception as e:
                print(f"[ERROR] Batch error: {e}")
                failed += len(batch_tickers)
        
        if len(price_data_dict) == 0:
            raise ValueError("Failed to retrieve any valid stock price data from Yahoo Finance.")
        
        # Create DataFrame and clean data
        self.price_data = pd.DataFrame(price_data_dict)
        self.price_data = self.price_data.sort_index()
        
        # Forward fill then backward fill missing values
        self.price_data = self.price_data.ffill().bfill()
        
        # Remove stocks with too many missing values (>20% missing)
        self.price_data = self.price_data.dropna(axis=1, thresh=len(self.price_data) * 0.8)
        
        print(f"\n[SUCCESS] Price data ready:")
        print(f"  - Successful: {successful} stocks")
        print(f"  - Failed: {failed} stocks")
        print(f"  - Final dataset: {len(self.price_data.columns)} stocks, {len(self.price_data)} dates")
        
        # Save raw data to CSV
        self._save_raw_data_to_csv(
            self.price_data,
            'raw_price_data.csv',
            'Raw price data (Close prices)'
        )
        
        # Save to cache
        if use_cache:
            self._save_cached_data('price_data', self.price_data)
        
        return self.price_data
    
    def fetch_market_caps(self, use_cache=True):
        """
        Fetch market cap data from Yahoo Finance
        Saves raw data to CSV files
        """
        if self.price_data is None or len(self.price_data.columns) == 0:
            raise ValueError("Must fetch price data first")
        
        # Try to load from cache first
        if use_cache:
            cached_data = self._load_cached_data('market_caps')
            if cached_data is not None:
                # Filter to only stocks we have price data for
                price_stocks = set(self.price_data.columns)
                cached_filtered = cached_data[cached_data.index.isin(price_stocks)]
                if len(cached_filtered) > 0:
                    self.market_caps = cached_filtered
                    print(f"[CACHE] Loaded market cap data: {len(self.market_caps)} stocks")
                    # Still save to CSV even if from cache
                    self._save_raw_data_to_csv(
                        self.market_caps,
                        'raw_market_caps.csv',
                        'Raw market cap data (from cache)'
                    )
                    return self.market_caps
        
        print(f"\nFetching market cap data from Yahoo Finance...")
        print(f"Processing {len(self.price_data.columns)} stocks...\n")
        
        market_caps = {}
        successful = 0
        estimated = 0
        
        for idx, ticker in enumerate(self.price_data.columns, 1):
            print(f"[{idx}/{len(self.price_data.columns)}] {ticker}...", end=" ", flush=True)
            
            try:
                ticker_obj = yf.Ticker(ticker)
                info = ticker_obj.info
                
                if info and 'marketCap' in info and info['marketCap']:
                    market_cap = info['marketCap']
                    if market_cap > 0:
                        market_caps[ticker] = market_cap
                        successful += 1
                        print(f"[OK] ${market_cap/1e9:.2f}B")
                    else:
                        # Fallback to estimation
                        latest_price = self.price_data[ticker].iloc[-1]
                        estimated_cap = latest_price * 1e9
                        market_caps[ticker] = estimated_cap
                        estimated += 1
                        print(f"[EST] ${estimated_cap/1e9:.2f}B")
                else:
                    # Estimate from latest price
                    latest_price = self.price_data[ticker].iloc[-1]
                    estimated_cap = latest_price * 1e9
                    market_caps[ticker] = estimated_cap
                    estimated += 1
                    print(f"[EST] ${estimated_cap/1e9:.2f}B")
                
            except Exception as e:
                # Fallback to estimation on error
                latest_price = self.price_data[ticker].iloc[-1]
                estimated_cap = latest_price * 1e9
                market_caps[ticker] = estimated_cap
                estimated += 1
                print(f"[EST] (error)")
        
        self.market_caps = pd.Series(market_caps).dropna()
        
        print(f"\n[SUCCESS] Market cap data:")
        print(f"  - From API: {successful} stocks")
        print(f"  - Estimated: {estimated} stocks")
        print(f"  - Total: {len(self.market_caps)} stocks")
        
        # Save raw data to CSV
        market_caps_df = pd.DataFrame({
            'Ticker': self.market_caps.index,
            'Market Cap (Raw)': self.market_caps.values,
            'Market Cap (Billions)': self.market_caps.values / 1e9
        }).set_index('Ticker')
        
        self._save_raw_data_to_csv(
            market_caps_df,
            'raw_market_caps.csv',
            'Raw market cap data'
        )
        
        # Save to cache
        if use_cache:
            self._save_cached_data('market_caps', self.market_caps)
        
        return self.market_caps
    
    def get_market_cap_weights(self):
        """
        Calculate market cap weights for portfolio
        """
        if self.market_caps is None or len(self.market_caps) == 0:
            self.fetch_market_caps()
        
        # Only use stocks we have price data for
        common_stocks = set(self.price_data.columns) & set(self.market_caps.index)
        filtered_caps = self.market_caps[self.market_caps.index.isin(common_stocks)]
        
        if len(filtered_caps) == 0:
            # Fallback: equal weights
            filtered_caps = pd.Series(1.0, index=self.price_data.columns)
        
        weights = filtered_caps / filtered_caps.sum()
        return weights.sort_values(ascending=False)
    
    def get_returns(self):
        """
        Calculate log returns from price data
        """
        if self.price_data is None:
            raise ValueError("Must fetch price data first")
        
        returns = np.log(self.price_data / self.price_data.shift(1)).dropna()
        
        # Save raw returns to CSV
        self._save_raw_data_to_csv(
            returns,
            'raw_returns_data.csv',
            'Raw returns data (log returns)'
        )
        
        return returns
    
    def get_covariance_matrix(self):
        """
        Calculate annualized covariance matrix of returns
        """
        returns = self.get_returns()
        cov_matrix = returns.cov() * 252  # Annualized (252 trading days per year)
        
        # Save raw covariance matrix to CSV
        self._save_raw_data_to_csv(
            cov_matrix,
            'raw_covariance_matrix.csv',
            'Raw covariance matrix (annualized)'
        )
        
        return cov_matrix


def prepare_market_data(start_date, end_date, use_cache=True):
    """
    Complete pipeline to prepare all market data using Yahoo Finance
    Saves all raw data to CSV files
    
    Parameters:
    -----------
    start_date : str
        Start date for data (YYYY-MM-DD)
    end_date : str
        End date for data (YYYY-MM-DD)
    use_cache : bool
        Whether to use cached data if available (default: True)
    """
    fetcher = YahooFinanceDataFetcher(start_date, end_date)
    
    # Step 1: Get S&P 500 constituent list
    print("STEP 1: Getting S&P 500 constituent list...")
    print("-" * 80)
    fetcher.get_sp500_constituents()
    
    # Step 2: Fetch price data
    print("\nSTEP 2: Fetching price data from Yahoo Finance...")
    print("-" * 80)
    fetcher.fetch_price_data(use_cache=use_cache)
    
    # Step 3: Fetch market cap data
    print("\nSTEP 3: Fetching market cap data...")
    print("-" * 80)
    fetcher.fetch_market_caps(use_cache=use_cache)
    
    # Step 4: Calculate market cap weights
    weights = fetcher.get_market_cap_weights()
    
    # Step 5: Calculate returns and covariance matrix
    returns = fetcher.get_returns()
    cov_matrix = fetcher.get_covariance_matrix()
    
    # Align weights with covariance matrix
    common_assets = weights.index.intersection(cov_matrix.index)
    weights_aligned = weights[common_assets]
    cov_matrix_aligned = cov_matrix.loc[common_assets, common_assets]
    
    print(f"\n[SUCCESS] Market data prepared:")
    print(f"  - Total stocks: {len(weights_aligned)}")
    print(f"  - Return period: {len(returns)} trading days")
    print(f"  - Date range: {returns.index[0].date()} to {returns.index[-1].date()}")
    print(f"  - Average annualized volatility: {returns.std().mean()*np.sqrt(252):.2%}")
    
    return fetcher, weights_aligned, cov_matrix_aligned, returns
