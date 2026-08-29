// ═══════════════════════════════════════════════════════════════════
// SAMPLE IG BOND UNIVERSE & CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SAMPLE_BONDS = [
  { id: "AAPL", issuer: "Apple Inc.", sector: "Technology", rating: "AA+", oas: 45, spreadDur: 4.2, pd: 0.0003, lgd: 0.4, mktValue: 5200, matBucket: "3-5y" },
  { id: "MSFT", issuer: "Microsoft Corp.", sector: "Technology", rating: "AAA", oas: 35, spreadDur: 5.1, pd: 0.0001, lgd: 0.4, mktValue: 6100, matBucket: "5-7y" },
  { id: "JPM", issuer: "JPMorgan Chase", sector: "Financials", rating: "A+", oas: 72, spreadDur: 3.8, pd: 0.0008, lgd: 0.45, mktValue: 4800, matBucket: "3-5y" },
  { id: "BAC", issuer: "Bank of America", sector: "Financials", rating: "A", oas: 85, spreadDur: 4.5, pd: 0.0012, lgd: 0.45, mktValue: 4200, matBucket: "3-5y" },
  { id: "GS", issuer: "Goldman Sachs", sector: "Financials", rating: "A+", oas: 78, spreadDur: 3.2, pd: 0.0010, lgd: 0.45, mktValue: 3100, matBucket: "3-5y" },
  { id: "JNJ", issuer: "Johnson & Johnson", sector: "Healthcare", rating: "AAA", oas: 32, spreadDur: 6.0, pd: 0.0001, lgd: 0.4, mktValue: 4500, matBucket: "5-7y" },
  { id: "PFE", issuer: "Pfizer Inc.", sector: "Healthcare", rating: "A+", oas: 62, spreadDur: 4.8, pd: 0.0006, lgd: 0.4, mktValue: 3200, matBucket: "5-7y" },
  { id: "UNH", issuer: "UnitedHealth Group", sector: "Healthcare", rating: "A+", oas: 68, spreadDur: 5.5, pd: 0.0007, lgd: 0.4, mktValue: 3800, matBucket: "5-7y" },
  { id: "XOM", issuer: "Exxon Mobil", sector: "Energy", rating: "AA-", oas: 55, spreadDur: 4.0, pd: 0.0005, lgd: 0.4, mktValue: 3600, matBucket: "3-5y" },
  { id: "CVX", issuer: "Chevron Corp.", sector: "Energy", rating: "AA-", oas: 52, spreadDur: 3.5, pd: 0.0004, lgd: 0.4, mktValue: 3000, matBucket: "3-5y" },
  { id: "PG", issuer: "Procter & Gamble", sector: "Consumer Staples", rating: "AA-", oas: 40, spreadDur: 5.2, pd: 0.0002, lgd: 0.4, mktValue: 3900, matBucket: "5-7y" },
  { id: "KO", issuer: "Coca-Cola Co.", sector: "Consumer Staples", rating: "A+", oas: 48, spreadDur: 4.6, pd: 0.0004, lgd: 0.4, mktValue: 3400, matBucket: "3-5y" },
  { id: "T", issuer: "AT&T Inc.", sector: "Communications", rating: "BBB", oas: 125, spreadDur: 6.8, pd: 0.0035, lgd: 0.45, mktValue: 4100, matBucket: "7-10y" },
  { id: "VZ", issuer: "Verizon Comms.", sector: "Communications", rating: "BBB+", oas: 105, spreadDur: 6.2, pd: 0.0025, lgd: 0.45, mktValue: 3700, matBucket: "7-10y" },
  { id: "NEE", issuer: "NextEra Energy", sector: "Utilities", rating: "A-", oas: 70, spreadDur: 5.0, pd: 0.0009, lgd: 0.4, mktValue: 2800, matBucket: "5-7y" },
  { id: "D", issuer: "Dominion Energy", sector: "Utilities", rating: "BBB+", oas: 95, spreadDur: 5.8, pd: 0.0020, lgd: 0.4, mktValue: 2400, matBucket: "5-7y" },
  { id: "CAT", issuer: "Caterpillar Inc.", sector: "Industrials", rating: "A", oas: 58, spreadDur: 3.6, pd: 0.0007, lgd: 0.4, mktValue: 2600, matBucket: "3-5y" },
  { id: "HON", issuer: "Honeywell Int'l", sector: "Industrials", rating: "A", oas: 55, spreadDur: 4.1, pd: 0.0006, lgd: 0.4, mktValue: 2900, matBucket: "3-5y" },
  { id: "UNP", issuer: "Union Pacific", sector: "Industrials", rating: "A-", oas: 65, spreadDur: 5.3, pd: 0.0008, lgd: 0.4, mktValue: 2500, matBucket: "5-7y" },
  { id: "BLK", issuer: "BlackRock Inc.", sector: "Financials", rating: "A+", oas: 68, spreadDur: 3.9, pd: 0.0007, lgd: 0.45, mktValue: 2200, matBucket: "3-5y" },
  { id: "AMZN", issuer: "Amazon.com", sector: "Technology", rating: "AA", oas: 42, spreadDur: 4.7, pd: 0.0002, lgd: 0.4, mktValue: 4600, matBucket: "5-7y" },
  { id: "META", issuer: "Meta Platforms", sector: "Technology", rating: "AA-", oas: 50, spreadDur: 3.4, pd: 0.0003, lgd: 0.4, mktValue: 3300, matBucket: "3-5y" },
  { id: "BMY", issuer: "Bristol-Myers Squibb", sector: "Healthcare", rating: "A", oas: 75, spreadDur: 5.6, pd: 0.0010, lgd: 0.4, mktValue: 2700, matBucket: "5-7y" },
  { id: "F", issuer: "Ford Motor Co.", sector: "Consumer Disc.", rating: "BBB-", oas: 155, spreadDur: 4.2, pd: 0.0055, lgd: 0.5, mktValue: 2100, matBucket: "3-5y" },
  { id: "GM", issuer: "General Motors", sector: "Consumer Disc.", rating: "BBB", oas: 135, spreadDur: 3.8, pd: 0.0040, lgd: 0.5, mktValue: 2300, matBucket: "3-5y" },
];

export const SECTORS = [...new Set(SAMPLE_BONDS.map(b => b.sector))];
export const RATING_ORDER = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-"];
export const SECTOR_COLORS = {
  Technology: "#3b82f6", Financials: "#10b981", Healthcare: "#8b5cf6",
  Energy: "#f59e0b", "Consumer Staples": "#ec4899", Communications: "#ef4444",
  Utilities: "#14b8a6", Industrials: "#f97316", "Consumer Disc.": "#6366f1",
};
