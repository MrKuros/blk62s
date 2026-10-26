"""API contract (Pydantic v2). Frozen after the contract phase: the frontend types are generated from it.

Conventions:
- Times are UTC ISO-8601; the UI renders Europe/London.
- MW values are rounded to integers by the service, ratios to 4 dp.
- Errors are actual - forecast, so a negative value means the forecast was too high.
- Hourly arrays are aligned to the London-local delivery day (23, 24 or 25 hours).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Calib = Literal["jan", "dec"]
AuctionId = Literal["epex", "n2ex"]
SourceState = Literal["checking", "verified", "changed", "unreachable"]
SignalId = Literal["above_ceiling", "revision", "correction", "calibrating", "run_jump"]
Alignment = Literal["hour_mean", "hh_start", "centred"]
Method = Literal["ratio", "additive", "per_level"]
ExportView = Literal["replay", "accuracy", "firm", "waiting"]

MW = float
MaybeMW = float | None
HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", examples=["09:20"])]
Quantiles = Annotated[
    list[float],
    Field(
        min_length=99,
        max_length=99,
        description="Walk-forward percentiles of actual/corrected; q[i] is P(i+1), ascending.",
    ),
]


class Model(BaseModel):
    # Forbid unknown keys so a typo in a view or fixture fails loudly instead of vanishing. Defaults are
    # always serialised, so the schema marks them required and the generated TS types are not optional.
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


# ---------------------------------------------------------------- shared


class CI(Model):
    """Point estimate with an approximate 90% moving-block bootstrap interval."""

    value: float
    lo: float
    hi: float


class Params(Model):
    cutoff: str = Field(description="As requested: 'epex', 'n2ex' or 'HH:MM' (Europe/London, D-1).")
    cutoff_local: HHMM = Field(description="Resolved local cutoff on D-1, before the margin.")
    margin: int = Field(description="Data-latency margin in minutes subtracted from the cutoff.")
    calib: Calib
    day: date | None = None


class SourceStatus(Model):
    state: SourceState
    checked_at: datetime | None = None


class Sig(Model):
    """A deterministic signal; the frontend renders the sentence from id + params."""

    id: SignalId
    params: dict[str, float | int | str]


class RunInfo(Model):
    publish_time: datetime
    hours_ahead_min: float = Field(description="Lead from publish time to the first delivery hour, h.")
    hours_ahead_max: float
    n_hours: int


class Calibration(Model):
    status: Literal["ok", "calibrating"]
    train_days: int
    train_window: tuple[date, date] | None = Field(None, description="First and last training day.")
    a: float | None = Field(None, description="Correction intercept: corrected = a + b * raw.")
    b: float | None = None
    q: Quantiles | None = None


# ---------------------------------------------------------------- meta


class Auction(Model):
    id: AuctionId
    label: str
    local_time: HHMM


class Slot(Model):
    id: str = Field(description="'d2_0230' .. 'd1_2230'.", examples=["d1_0730"])
    day_offset: Literal[-2, -1]
    local_time: HHMM


class Meta(Model):
    version: str
    data_hash: str
    snapshot_fetched_at: datetime
    source: SourceStatus
    days: list[date] = Field(description="Delivery days of the January pilot.")
    auctions: list[Auction]
    margins: list[int]
    slots: list[Slot]
    excluded_day: date = Field(description="NESO IT-failure day, optionally excluded from firm stats.")


# ---------------------------------------------------------------- replay


class ReplayHour(Model):
    t: datetime
    raw: MaybeMW
    corrected: MaybeMW
    actual: MaybeMW


class ReplayRun(Model):
    publish_time: datetime
    too_late: bool = Field(description="Published at or after the cutoff.")
    values: list[MaybeMW] = Field(description="Aligned to Replay.hours; null where the run has no value.")


class ReplayKpis(Model):
    forecast_avg_mw: MaybeMW
    forecast_peak_mw: MaybeMW
    correction_avg_mw: MaybeMW = Field(description="mean(corrected - raw); negative lowers the forecast.")


class ReplayAuctionCompare(Model):
    epex_publish_time: datetime | None
    n2ex_publish_time: datetime | None
    mean_diff_mw: MaybeMW = Field(description="mean(N2EX run - EPEX run) over the day's hours.")


class Replay(Model):
    data_hash: str
    params: Params
    decision_run: RunInfo | None
    hours: list[ReplayHour]
    runs: list[ReplayRun] = Field(description="Every run published D-2 00:00 to D-1 23:59 local.")
    calibration: Calibration
    persistence_mw: MaybeMW = Field(description="Last delivered wind known before the cutoff.")
    kpis: ReplayKpis
    auction_compare: ReplayAuctionCompare
    signal: Sig | None
    watch: list[Sig]


# ---------------------------------------------------------------- accuracy


class Ols(Model):
    a: float
    b: float


class CorrectedEffect(Model):
    n_days: int = Field(description="Non-calibrating days; all three CIs are paired on them.")
    raw_mae: CI
    corrected_mae: CI
    gain: CI = Field(description="corrected_mae - raw_mae; negative is an improvement.")


class LevelBin(Model):
    label: str
    lo_mw: MW
    hi_mw: MaybeMW = Field(description="null for the open-ended top bin.")
    n: int
    raw_p10: MaybeMW
    raw_p50: MaybeMW
    raw_p90: MaybeMW
    corr_p10: MaybeMW
    corr_p50: MaybeMW
    corr_p90: MaybeMW


class AccuracyDay(Model):
    day: date
    mean_forecast_mw: MW
    mean_actual_mw: MW
    raw_mae: MW
    raw_bias: MW
    corrected_mae: MaybeMW = Field(description="null while calibrating.")


class SensitivityRow(Model):
    alignment: Alignment
    mae: MW
    bias: MW


class Baselines(Model):
    persistence_mae: MW
    d2_mae: MaybeMW = Field(description="Same-time D-2 run, on the hours it covers; null if it covers none.")
    d2_decision_mae: MaybeMW = Field(description="Decision run on the same hours as d2_mae.")
    d2_n_hours: int


class AccuracyAuctionCompare(Model):
    epex_mae: MW
    n2ex_mae: MW
    diff: CI = Field(description="n2ex_mae - epex_mae, paired.")


class Accuracy(Model):
    data_hash: str
    params: Params
    n_hours: int
    n_days: int
    mae: CI
    bias: CI
    wape: CI = Field(description="Sum |error| / sum actual, as a fraction.")
    rmse: MW
    over_share: float = Field(description="Fraction of hours where the forecast was above actual.")
    corr: float
    ols: Ols
    corrected: CorrectedEffect
    by_level: list[LevelBin]
    ceiling_mw: MW = Field(description="Highest hourly delivered wind in the pilot.")
    days: list[AccuracyDay]
    sensitivity: list[SensitivityRow]
    baselines: Baselines
    auction_compare: AccuracyAuctionCompare


# ---------------------------------------------------------------- firm


class FirmDay(Model):
    day: date
    calibrating: bool
    raw: list[MaybeMW]
    corrected: list[MaybeMW]
    actual: list[MaybeMW]
    q: Quantiles | None = None


class MethodRow(Model):
    method: Method
    r: int = Field(description="Accepted shortfall, % of hours.")
    exclude_28: bool
    hour_cov: float
    day_cov: float
    firm_pct: float = Field(description="Firm wind as a fraction of the raw forecast.")
    n_hours: int
    n_days: int
    fallback_bins: int = Field(description="per_level only: bins that fell back to the pooled quantile.")


class Firm(Model):
    data_hash: str
    params: Params
    days: list[FirmDay]
    methods: list[MethodRow]


# ---------------------------------------------------------------- waiting


class PostGate(Model):
    epex: bool
    n2ex: bool


class WaitingSlot(Model):
    id: str
    day_offset: Literal[-2, -1]
    local_time: HHMM
    mae: CI
    bias: MW
    rmse: MW
    n_hours: int
    post_gate: PostGate


class Gate(Model):
    auction: AuctionId
    local_time: HHMM
    last_slot_id: str = Field(description="Latest slot published before this gate on D-1.")


class Gain(Model):
    auction: AuctionId
    from_slot: str
    to_slot: str
    diff: CI = Field(description="MAE(to_slot) - MAE(from_slot), paired; negative means waiting helped.")


class Waiting(Model):
    data_hash: str
    common_hours: int = Field(description="Hours covered by every slot; all slot metrics use only these.")
    slots: list[WaitingSlot]
    gates: list[Gate]
    gains: list[Gain]
    auction_diff: CI = Field(description="MAE(N2EX gate run) - MAE(EPEX gate run), paired.")


# ---------------------------------------------------------------- live


class LiveHour(Model):
    t: datetime
    raw: MaybeMW
    corrected: MaybeMW


class Live(Model):
    status: Literal["ok", "unavailable"]
    message: str | None = None
    fetched_at: datetime | None = None
    target_day: date
    params: Params
    cutoff_utc: datetime
    gate_passed: bool
    decision_run: RunInfo | None = None
    latest_publish_time: datetime | None = None
    hours: list[LiveHour]
    calibration: Calibration | None = Field(None, description="Trailing-30-day walk-forward fit.")


# ---------------------------------------------------------------- health + errors


class Health(Model):
    ok: bool
    version: str
    data_hash: str
    source: SourceStatus


class ErrorDetail(Model):
    code: str
    message: str
    field: str | None = None


class ErrorBody(Model):
    error: ErrorDetail
