"""
Configuration settings for Black-Litterman Model
"""

# Data source: Yahoo Finance (no API key needed)

# Market parameters
RISK_FREE_RATE = 0.04  # 4% annual risk-free rate
MARKET_RISK_PREMIUM = 0.05  # 5% annual market risk premium

# Data parameters
DATA_START_DATE = "2020-01-01"
DATA_END_DATE = "2025-12-31"

# Black-Litterman parameters
TAU = 0.05  # Scalar controlling the uncertainty of the prior (typically 0.01-0.05)
CONFIDENCE = 0.95  # Confidence level in views (0-1)

# Optimization parameters
MIN_WEIGHT = 0.0  # Minimum weight per asset
MAX_WEIGHT = 0.1  # Maximum weight per asset (10% max per stock)

# Output parameters
TOP_N_STOCKS = 50  # Number of stocks to display in results
OUTPUT_RESULTS = True
PLOT_RESULTS = True
