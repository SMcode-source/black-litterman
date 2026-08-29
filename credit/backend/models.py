"""Pydantic models for request/response validation."""
from typing import Optional
from pydantic import BaseModel, Field


class BondData(BaseModel):
    id: str
    issuer: str
    sector: str
    rating: str
    oas: float = Field(description="Option-adjusted spread in basis points")
    spread_duration: float = Field(description="Spread duration in years")
    pd_annual: float = Field(description="Annualised probability of default")
    lgd: float = Field(default=0.4, description="Loss given default (1 - recovery)")
    mkt_value: float = Field(description="Market value for benchmark weighting")
    maturity_bucket: str = Field(default="3-5y")
    ytm: Optional[float] = Field(default=None, description="Yield to maturity in %")
    coupon_rate: Optional[float] = Field(default=None, description="Coupon rate in %")
    maturity_date: Optional[str] = Field(default=None, description="Maturity date (YYYY-MM-DD)")
    face_value: Optional[float] = Field(default=None, description="Face/par value")
    market_price: Optional[float] = Field(default=None, description="Current market price")


class ViewInput(BaseModel):
    view_type: str = Field(description="ABSOLUTE or RELATIVE")
    long_assets: list[str]
    short_assets: list[str] = []
    magnitude_bp: float = Field(description="Expected outperformance in bp")
    confidence: float = Field(default=0.5, ge=0.01, le=1.0)


class Constraints(BaseModel):
    max_issuer_weight: float = Field(default=5.0, description="Max single issuer weight %")
    min_position_size: float = Field(default=0.2, description="Min position size %")
    max_sector_overweight: float = Field(default=10.0, description="Max sector overweight vs bmk %")
    max_tracking_error: float = Field(default=150.0, description="Max TE in bp annualised")
    spread_duration_tolerance: float = Field(default=0.25, description="SD tolerance vs bmk in years")
    excluded_issuers: list[str] = Field(default=[])


class OptimisationRequest(BaseModel):
    bonds: list[BondData]
    views: list[ViewInput] = []
    constraints: Constraints = Constraints()
    delta: float = Field(default=2.5, description="Risk aversion coefficient")
    tau: float = Field(default=0.025, description="Prior uncertainty scalar")
    n_simulations: int = Field(default=50000, description="Monte Carlo simulations for Credit VaR")
    covariance_method: str = Field(default="factor_model", description="factor_model | ledoit_wolf | ewma")


class IssuerResult(BaseModel):
    id: str
    issuer: str
    sector: str
    rating: str
    benchmark_weight: float
    optimal_weight: float
    active_weight: float
    equilibrium_return_bp: float
    posterior_return_bp: float
    expected_loss_bp: float
    dts: float


class RiskMetrics(BaseModel):
    portfolio_return_bp: float
    portfolio_vol_bp: float
    sharpe_ratio: float
    tracking_error_bp: float
    information_ratio: float
    expected_loss_bp: float
    spread_duration: float
    dts: float
    credit_var_99_bp: float
    credit_cvar_99_bp: float


class SectorAllocation(BaseModel):
    sector: str
    benchmark: float
    optimal: float
    active: float


class RatingAllocation(BaseModel):
    rating_bucket: str
    benchmark: float
    optimal: float
    active: float


class ConstraintStatus(BaseModel):
    name: str
    bound: float
    value: float
    active: bool
    shadow_price: Optional[float] = None


class OptimisationResponse(BaseModel):
    status: str
    solver_status: str
    issuer_results: list[IssuerResult]
    risk_metrics: RiskMetrics
    sector_allocation: list[SectorAllocation]
    rating_allocation: list[RatingAllocation]
    constraint_status: list[ConstraintStatus]
    var_distribution: list[float] = Field(default=[], description="Loss distribution percentiles")
    warnings: list[str] = []


class ParsedBond(BaseModel):
    """Bond data as parsed from an uploaded file, ready for the frontend."""
    id: str
    issuer: str
    sector: str
    rating: str
    oas: float
    spread_duration: float
    pd_annual: float
    lgd: float = 0.4
    mkt_value: float
    maturity_bucket: str = "3-5y"
    ytm: Optional[float] = None
    coupon_rate: Optional[float] = None
    maturity_date: Optional[str] = None
    face_value: Optional[float] = None
    market_price: Optional[float] = None


class UploadResponse(BaseModel):
    status: str
    bonds: list[ParsedBond]
    row_count: int
    warnings: list[str] = []
    errors: list[str] = []
