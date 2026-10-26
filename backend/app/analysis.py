"""Forecast replay and accuracy analysis: pure functions over the WINDFOR / FUELHH frames, no I/O.

Conventions:
- All timestamps are tz-aware UTC; delivery days and cutoffs are defined in Europe/London.
- error = actual - forecast, so a negative error means the forecast was too high.
- A run is usable for delivery day D only if its publishTime is strictly before the cutoff on D-1.
- Training for day D uses delivery days <= D-2 whose actuals were published before D's cutoff.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from math import inf
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

LONDON = ZoneInfo("Europe/London")
Calib = Literal["jan", "dec"]
Alignment = Literal["hour_mean", "hh_start", "centred"]
Stat = Literal["mae", "bias", "rmse", "wape"]

AUCTIONS = {"epex": time(9, 20), "n2ex": time(9, 50)}
DAYS = [date(2026, 1, 2) + timedelta(days=i) for i in range(31)]  # delivery days decided in January
HISTORY_DAYS = [date(2025, 12, 1) + timedelta(days=i) for i in range(63)]  # snapshot: 1 Dec .. 1 Feb
TRAIN_START: dict[Calib, date] = {"jan": date(2026, 1, 2), "dec": date(2025, 12, 1)}
WARMUP_MIN_DAYS = 5
EXCLUDED_DAY = date(2026, 1, 28)  # NESO IT failure
LEVEL_BINS = [0, 5000, 10000, 15000, 20000, inf]
LEVEL_LABELS = ["<5 GW", "5–10 GW", "10–15 GW", "15–20 GW", ">20 GW"]
RUN_TIMES = [time(h, 30) for h in (2, 4, 7, 9, 11, 15, 18, 22)]  # nominal WINDFOR publish times (GMT)
SLOTS = [(offset, t) for offset in (-2, -1) for t in RUN_TIMES]
SLOT_GRACE = pd.Timedelta(minutes=59)  # catches late runs such as 12:25 for the 11:30 slot on 15 Jan
PCTS = np.arange(1, 100)
MIN_CORRECTED_MW = 500  # ratios to tiny corrected values are noise
PER_LEVEL_MIN_N = 30

HOUR = pd.Timedelta(hours=1)
HALF = pd.Timedelta(minutes=30)
_HHMM = re.compile(r"([01]\d|2[0-3]):([0-5]\d)")
_SUM_COLS = ["n", "abs", "sum", "sq", "actual"]


# ---------------------------------------------------------------- time / DST


def parse_cutoff(cutoff: str) -> time:
    """'epex' | 'n2ex' | 'HH:MM' (Europe/London, on D-1)."""
    if cutoff in AUCTIONS:
        return AUCTIONS[cutoff]
    m = _HHMM.fullmatch(cutoff)
    if not m:
        raise ValueError(f"cutoff must be 'epex', 'n2ex' or HH:MM, got {cutoff!r}")
    return time(int(m[1]), int(m[2]))


def local_utc(day: date, t: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(day, t, tzinfo=LONDON)).tz_convert("UTC")


def cutoff_utc(day: date, local: time, margin_min: int = 0) -> pd.Timestamp:
    """Decision cutoff for delivery day `day`: `local` on D-1 in London, minus the latency margin."""
    return local_utc(day - timedelta(days=1), local) - pd.Timedelta(minutes=margin_min)


def delivery_hours(day: date) -> pd.DatetimeIndex:
    """UTC hour starts of the London-local day: 23, 24 or 25 of them."""
    return pd.date_range(
        local_utc(day, time(0)), local_utc(day + timedelta(days=1), time(0)), freq="h", inclusive="left"
    )


# ---------------------------------------------------------------- clean / align


def clean_windfor(wf: pd.DataFrame) -> pd.DataFrame:
    """Drop hindcast rows: each run also re-states up to ~25 h before its publish time."""
    return wf[wf["startTime"] >= wf["publishTime"]].reset_index(drop=True)


def _hourly(fh: pd.DataFrame, how: Alignment) -> pd.DataFrame:
    """Hourly actual and the time it became known (latest publishTime of the half-hours used)."""
    s = fh.set_index("startTime").sort_index()
    hours = s.index.floor("h").unique()
    if how == "hh_start":
        parts = [hours]
    elif how == "hour_mean":
        parts = [hours, hours + HALF]
    elif how == "centred":
        parts = [hours - HALF, hours]
    else:
        raise ValueError(f"unknown alignment {how!r}")
    gen = np.column_stack([s["generation"].reindex(p).to_numpy() for p in parts])
    published = s["publishTime"].dt.tz_localize(None)  # naive UTC, so NaT-propagating numpy max works
    pub = np.column_stack([published.reindex(p).to_numpy() for p in parts])
    known = pub.max(axis=1)  # NaT propagates, matching the NaN actual
    return pd.DataFrame(
        {"actual": gen.mean(axis=1), "known_at": pd.to_datetime(known, utc=True)}, index=hours
    )


def hourly_actual(
    fh: pd.DataFrame, how: Alignment = "hour_mean", known_before: pd.Timestamp | None = None
) -> pd.Series:
    """Hourly delivered wind indexed by UTC hour start; NaN where a half-hour is missing.

    hour_mean: mean(HH[h], HH[h+30m]), the energy of the traded hour (pre-registered default).
    hh_start: HH[h].  centred: mean(HH[h-30m], HH[h]).
    known_before keeps only FUELHH rows published strictly before it.
    """
    if known_before is not None:
        fh = fh[fh["publishTime"] < known_before]
    return _hourly(fh, how)["actual"]


# ---------------------------------------------------------------- decision run


def run_for_day(wf: pd.DataFrame, day: date, cut: pd.Timestamp) -> pd.DataFrame:
    """Rows of the latest run published strictly before `cut`, restricted to delivery day `day`."""
    pubs = wf.loc[wf["publishTime"] < cut, "publishTime"]
    if pubs.empty:
        return wf.iloc[:0]
    run = wf[wf["publishTime"] == pubs.max()]
    return run[run["startTime"].isin(delivery_hours(day))].reset_index(drop=True)


def frame_for_cutoffs(
    wf: pd.DataFrame,
    actual: pd.Series,
    days: Sequence[date],
    cuts: Sequence[pd.Timestamp],
    known_at: pd.Series | None = None,
) -> pd.DataFrame:
    """For each day, the latest run strictly before its cutoff, joined to the hourly actual.

    Columns: day, startTime, publishTime, forecast, actual, err, lead_h, cutoff, and known_at when
    given (walk_forward needs it). Days with no run before their cutoff are absent.
    """
    pubs = pd.DatetimeIndex(wf["publishTime"].unique()).sort_values()
    cut_idx = pd.DatetimeIndex(list(cuts), tz="UTC")
    if pubs.empty:  # e.g. Elexon answered with no runs
        days, cut_idx = [], cut_idx[:0]
    run_i = pubs.searchsorted(cut_idx, side="left") - 1  # latest publish strictly before each cutoff
    hours = [delivery_hours(d) for d in days]
    rep = np.repeat(np.arange(len(days)), [len(h) for h in hours])
    start = hours[0].append(hours[1:]) if hours else pd.DatetimeIndex([], tz="UTC")
    publish = pubs[np.maximum(run_i, 0)[rep]]
    gen = wf.set_index(["publishTime", "startTime"])["generation"]
    forecast = gen.reindex(pd.MultiIndex.from_arrays([publish, start])).to_numpy()
    keep = (run_i[rep] >= 0) & ~np.isnan(forecast)
    out = pd.DataFrame(
        {
            "day": np.array(days, dtype=object)[rep][keep],
            "startTime": start[keep],
            "publishTime": publish[keep],
            "forecast": forecast[keep],
            "cutoff": cut_idx[rep][keep],
        }
    )
    act = actual.reindex(pd.DatetimeIndex(out["startTime"])).to_numpy()
    out = out.assign(
        actual=act,
        err=act - out["forecast"].to_numpy(dtype=float),
        lead_h=(out["startTime"] - out["publishTime"]) / HOUR,
    )
    if known_at is not None:
        out = out.assign(known_at=known_at.reindex(pd.DatetimeIndex(out["startTime"])).to_numpy())
    return out


def decision_frame(
    wf: pd.DataFrame,
    fh: pd.DataFrame,
    days: Sequence[date],
    local: time,
    margin: int,
    how: Alignment = "hour_mean",
) -> pd.DataFrame:
    """Decision run per delivery day vs the hourly actual (see frame_for_cutoffs for columns).

    Takes FUELHH rather than a ready-made actual series so that every row carries `known_at`, which
    walk_forward needs to keep late-published actuals out of training.
    """
    hourly = _hourly(fh, how)
    cuts = [cutoff_utc(d, local, margin) for d in days]
    return frame_for_cutoffs(wf, hourly["actual"], days, cuts, hourly["known_at"])


# ---------------------------------------------------------------- metrics + bootstrap


def metrics(err: Iterable[float], actual: Iterable[float]) -> dict[str, float]:
    e, a = np.asarray(err, dtype=float), np.asarray(actual, dtype=float)
    ok = ~(np.isnan(e) | np.isnan(a))
    e, a = e[ok], a[ok]
    if not len(e):
        return {"n": 0, "mae": np.nan, "bias": np.nan, "rmse": np.nan, "wape": np.nan}
    ae = np.abs(e)
    return {
        "n": len(e),
        "mae": ae.mean(),
        "bias": e.mean(),
        "rmse": np.sqrt((e**2).mean()),
        "wape": ae.sum() / a.sum(),
    }


def day_sums(frame: pd.DataFrame, err_col: str = "err") -> pd.DataFrame:
    """Per-day sufficient statistics, so bootstrap resamples are sums of rows rather than recomputes."""
    df = frame[frame[err_col].notna() & frame["actual"].notna()]
    e = df[err_col].to_numpy(dtype=float)
    parts = pd.DataFrame(
        {"n": 1, "abs": np.abs(e), "sum": e, "sq": e**2, "actual": df["actual"].to_numpy()}, index=df.index
    )
    return parts.groupby(df["day"]).sum().sort_index()


def block_bootstrap_idx(n_days: int, n_boot: int = 2000, block: int = 3, seed: int = 20260101) -> np.ndarray:
    """Moving-block resample indices, shape (n_boot, n_days): contiguous runs of `block` days, because
    errors are strongly autocorrelated within and across neighbouring days."""
    block = min(block, n_days)
    n_blocks = -(-n_days // block)
    starts = np.random.default_rng(seed).integers(0, n_days - block + 1, size=(n_boot, n_blocks))
    return (starts[:, :, None] + np.arange(block)).reshape(n_boot, -1)[:, :n_days]


_STATS = {
    "mae": lambda s: s[..., 1] / s[..., 0],
    "bias": lambda s: s[..., 2] / s[..., 0],
    "rmse": lambda s: np.sqrt(s[..., 3] / s[..., 0]),
    "wape": lambda s: s[..., 1] / s[..., 4],
}


def boot_ci(
    sums: pd.DataFrame, stat: Stat, idx: np.ndarray, other: pd.DataFrame | None = None
) -> tuple[float, float, float]:
    """(point, p5, p95) of `stat` over resampled days; with `other`, of stat(sums) - stat(other) on the
    same resampled days (paired)."""
    f = _STATS[stat]
    x = sums[_SUM_COLS].to_numpy(dtype=float)
    point, boot = f(x.sum(axis=0)), f(x[idx].sum(axis=1))
    if other is not None:
        if not other.index.equals(sums.index):
            raise ValueError("paired bootstrap needs the same days on both sides")
        y = other[_SUM_COLS].to_numpy(dtype=float)
        point, boot = point - f(y.sum(axis=0)), boot - f(y[idx].sum(axis=1))
    lo, hi = np.percentile(boot, [5, 95])
    return float(point), float(lo), float(hi)


# ---------------------------------------------------------------- walk-forward correction + ratio grid


@dataclass(frozen=True)
class DayFit:
    day: date
    train_days: int
    calibrating: bool
    a: float | None
    b: float | None
    q: np.ndarray | None  # 99 ratio percentiles, q[i] = P(i+1) of actual / corrected
    train_window: tuple[date, date] | None = None


def _train_rows(
    frame: pd.DataFrame, day: date, train_start: date, known_before: pd.Timestamp | None
) -> pd.DataFrame:
    # Delivery days train_start .. day-2, as a startTime window (datetime compares are vectorised).
    t = frame["startTime"]
    keep = (t >= local_utc(train_start, time(0))) & (t < local_utc(day - timedelta(days=1), time(0)))
    keep &= frame["actual"].notna()
    if known_before is not None:
        keep &= frame["known_at"] < known_before
    return frame[keep]


def fit_day(
    frame: pd.DataFrame,
    day: date,
    train_start: date,
    min_days: int = WARMUP_MIN_DAYS,
    known_before: pd.Timestamp | None = None,
) -> DayFit:
    """Correction and ratio grid for `day`, trained on delivery days train_start .. day-2 only (D-1
    actuals are not complete at the gate). known_before additionally drops actuals published late."""
    train = _train_rows(frame, day, train_start, known_before)
    days = sorted(train["day"].unique())
    if len(days) < min_days:
        return DayFit(day, len(days), True, None, None, None)
    f, y = train["forecast"].to_numpy(dtype=float), train["actual"].to_numpy(dtype=float)
    b, a = np.polyfit(f, y, 1)
    corrected = a + b * f
    ok = corrected >= MIN_CORRECTED_MW
    q = np.percentile(y[ok] / corrected[ok], PCTS)
    return DayFit(day, len(days), False, float(a), float(b), q, (days[0], days[-1]))


def walk_forward(
    frame: pd.DataFrame, days: Sequence[date], train_start: date
) -> tuple[pd.DataFrame, dict[date, DayFit]]:
    """Fit every day on its own past; returns the rows of `days` with corrected, cerr and calibrating.

    While calibrating, corrected = forecast (the UI shows the raw forecast as warm-up).
    """
    cuts = frame.drop_duplicates("day").set_index("day")["cutoff"]
    fits = {d: fit_day(frame, d, train_start, known_before=cuts.get(d)) for d in days}
    out = frame[frame["day"].isin(days)].reset_index(drop=True)
    per_day = pd.DataFrame(
        [(1.0 if f.b is None else f.b, 0.0 if f.a is None else f.a, f.calibrating) for f in fits.values()],
        index=list(fits),
        columns=["b", "a", "calibrating"],
    ).reindex(out["day"])
    corrected = per_day["a"].to_numpy() + per_day["b"].to_numpy() * out["forecast"].to_numpy()
    return out.assign(
        corrected=corrected,
        cerr=out["actual"].to_numpy() - corrected,
        calibrating=per_day["calibrating"].to_numpy(dtype=bool),
    ), fits


def firm(corrected: np.ndarray | pd.Series | float, q: np.ndarray, r: int) -> np.ndarray:
    """Wind you can count on: exceeded by the actual in about (100 - r)% of hours. r is % (1..50)."""
    if not 1 <= r <= 50:
        raise ValueError(f"r must be 1..50, got {r}")
    return np.maximum(0.0, np.asarray(corrected, dtype=float) * q[r - 1])


def _cov(df: pd.DataFrame, firm_mw: np.ndarray) -> dict[str, float | int]:
    if df.empty:
        return {
            "hour_cov": np.nan,
            "day_cov": np.nan,
            "n_hours": 0,
            "n_days": 0,
            "shortfall_gwh": 0.0,
            "firm_pct": np.nan,
        }
    actual = df["actual"].to_numpy(dtype=float)
    ok = pd.Series(actual >= firm_mw, index=df.index)
    return {
        "hour_cov": float(ok.mean()),
        "day_cov": float(ok.groupby(df["day"]).all().mean()),
        "n_hours": len(df),
        "n_days": int(df["day"].nunique()),
        "shortfall_gwh": float(np.maximum(0.0, firm_mw - actual).sum() / 1000),
        "firm_pct": float(firm_mw.sum() / df["forecast"].sum()),
    }


def _evaluated(frame: pd.DataFrame, fits: dict[date, DayFit], exclude: Iterable[date]) -> pd.DataFrame:
    keep = {d for d, f in fits.items() if not f.calibrating} - set(exclude)
    return frame[frame["day"].isin(keep) & frame["actual"].notna()]


def coverage(
    frame: pd.DataFrame, fits: dict[date, DayFit], r: int, exclude: Iterable[date] = frozenset()
) -> dict[str, float | int]:
    """Out-of-sample coverage of the ratio firm value on a walk_forward frame.

    Calibrating and excluded days are left out; n_hours / n_days say how much is left.
    """
    df = _evaluated(frame, fits, exclude)
    qr = df["day"].map({d: f.q[r - 1] for d, f in fits.items() if f.q is not None}).to_numpy(dtype=float)
    return _cov(df, np.maximum(0.0, df["corrected"].to_numpy(dtype=float) * qr))


def _level(forecast: pd.Series) -> pd.Series:
    return pd.cut(forecast, LEVEL_BINS, right=False, labels=False)


def method_table(
    frame: pd.DataFrame,
    wf_frame: pd.DataFrame,
    fits: dict[date, DayFit],
    train_start: date,
    rs: Sequence[int] = (10, 5),
) -> list[dict]:
    """Walk-forward comparison of firm methods, each with and without the excluded day.

    Takes walk_forward(frame, days, train_start)'s output rather than recomputing it; `frame` is the
    full decision frame, for the training residuals.

    ratio: corrected * P_r(actual / corrected) (the method used in the UI).
    additive: corrected + P_r(actual - corrected).
    per_level: additive, with the residual quantile taken per raw-forecast level bin; bins with fewer
    than 30 training hours fall back to the pooled quantile (counted in fallback_bins).
    """
    cuts = frame.groupby("day")["cutoff"].first()
    resid: dict[date, tuple[np.ndarray, np.ndarray]] = {}
    for d, f in fits.items():
        if not f.calibrating:
            tr = _train_rows(frame, d, train_start, cuts.get(d))
            res = tr["actual"].to_numpy() - (f.a + f.b * tr["forecast"].to_numpy())
            resid[d] = res, _level(tr["forecast"]).to_numpy()

    rows = []
    for r in rs:
        for exclude_28 in (False, True):
            df = _evaluated(wf_frame, fits, {EXCLUDED_DAY} if exclude_28 else ())
            corrected = df["corrected"].to_numpy(dtype=float)
            day = df["day"]
            q_ratio = day.map({d: f.q[r - 1] for d, f in fits.items() if f.q is not None}).to_numpy(float)
            q_add = day.map({d: np.percentile(res, r) for d, (res, _) in resid.items()}).to_numpy(float)
            lvl = _level(df["forecast"]).to_numpy()
            q_lvl = np.empty(len(df))
            fallbacks = 0
            for d, ix in df.groupby("day").indices.items():
                res, train_lvl = resid[d]
                pooled = np.percentile(res, r)
                for b in np.unique(lvl[ix]):
                    sel = ix[lvl[ix] == b]
                    in_bin = res[train_lvl == b]
                    if len(in_bin) >= PER_LEVEL_MIN_N:
                        q_lvl[sel] = np.percentile(in_bin, r)
                    else:
                        q_lvl[sel] = pooled
                        fallbacks += 1
            for method, firm_mw, fb in (
                ("ratio", corrected * q_ratio, 0),
                ("additive", corrected + q_add, 0),
                ("per_level", corrected + q_lvl, fallbacks),
            ):
                rows.append(
                    {
                        "method": method,
                        "r": r,
                        "exclude_28": exclude_28,
                        **_cov(df, np.maximum(0.0, firm_mw)),
                        "fallback_bins": fb,
                    }
                )
    return rows


def level_table(frame: pd.DataFrame) -> list[dict]:
    """Error percentiles per raw-forecast level bin. Raw errors use every hour; corrected errors only
    the hours of fitted (non-calibrating) days, where a correction exists."""
    lvl = _level(frame["forecast"])
    out = []
    for i, label in enumerate(LEVEL_LABELS):
        g = frame[(lvl == i) & frame["err"].notna()]
        c = g.loc[~g["calibrating"], "cerr"] if "cerr" in g else g.iloc[:0]["err"]
        raw = np.percentile(g["err"], [10, 50, 90]) if len(g) else [None] * 3
        cor = np.percentile(c, [10, 50, 90]) if len(c) else [None] * 3
        out.append(
            {
                "label": label,
                "lo_mw": float(LEVEL_BINS[i]),
                "hi_mw": None if LEVEL_BINS[i + 1] == inf else float(LEVEL_BINS[i + 1]),
                "n": len(g),
                "bias": float(g["err"].mean()) if len(g) else None,
                **{
                    f"raw_p{p}": None if v is None else float(v)
                    for p, v in zip((10, 50, 90), raw, strict=True)
                },
                **{
                    f"corr_p{p}": None if v is None else float(v)
                    for p, v in zip((10, 50, 90), cor, strict=True)
                },
            }
        )
    return out


# ---------------------------------------------------------------- waiting + baselines


def slot_id(offset: int, t: time) -> str:
    return f"d{-offset}_{t:%H%M}"


def slot_frames(wf: pd.DataFrame, actual: pd.Series, days: Sequence[date]) -> dict[str, pd.DataFrame]:
    """Latest run available at each nominal publish slot from D-2 02:30 to D-1 22:30 (London), with a
    59-minute grace so an off-schedule run lands in its own slot.

    The grace reaches past the auction gates (d1_0930 closes at 10:29, N2EX at 09:50), so a slot is
    not a gate run: compare against decision_frame for anything gate-related.
    """
    return {
        slot_id(offset, t): frame_for_cutoffs(
            wf, actual, days, [local_utc(d + timedelta(days=offset), t) + SLOT_GRACE for d in days]
        )
        for offset, t in SLOTS
    }


def common_hours(frames: dict[str, pd.DataFrame]) -> pd.DatetimeIndex:
    """Delivery hours (with an actual) present in every frame, so slot metrics compare like for like."""
    sets = [pd.DatetimeIndex(f.loc[f["actual"].notna(), "startTime"]) for f in frames.values()]
    out = sets[0]
    for s in sets[1:]:
        out = out.intersection(s)
    return out.sort_values()


def persistence(fh: pd.DataFrame, cut: pd.Timestamp) -> float | None:
    """Latest half-hour of delivered wind whose publishTime is before the cutoff."""
    known = fh[fh["publishTime"] < cut]
    return None if known.empty else float(known.loc[known["startTime"].idxmax(), "generation"])


def ceiling_known(fh: pd.DataFrame, train_start: date, cut: pd.Timestamp) -> float | None:
    """Highest hourly delivered wind from train_start, using only data published before the cutoff.

    None during the warm-up: a day or two of history says nothing about a ceiling.
    """
    start = local_utc(train_start, time(0))
    if cut - start < pd.Timedelta(days=WARMUP_MIN_DAYS):
        return None
    s = hourly_actual(fh[fh["startTime"] >= start], known_before=cut).dropna()
    return float(s.max()) if len(s) else None


def unchanged_runs(wf: pd.DataFrame, pub: pd.Timestamp) -> tuple[int, pd.Timestamp]:
    """How many consecutive runs, ending with the one published at `pub`, repeat the same values where
    they overlap (1 = it was a fresh update), and the publish time of the first of them.

    On 28 Jan the NESO feed froze: the decision run repeated every run since 26 Jan 18:30.
    """
    published = wf["publishTime"].dt.tz_localize(None).to_numpy()
    pubs = np.unique(published)
    starts = wf["startTime"].dt.tz_localize(None).to_numpy()
    i = int(np.searchsorted(pubs, pub.tz_convert(None).to_datetime64()))
    if i == len(pubs) or pubs[i] != pub.tz_convert(None).to_datetime64():
        raise KeyError(f"no run published at {pub}")

    def run(k: int) -> pd.Series:
        rows = published == pubs[k]
        return pd.Series(wf["generation"].to_numpy()[rows], index=starts[rows])

    cur, n = run(i), 1
    while i - n >= 0:
        prev = run(i - n)
        common = cur.index.intersection(prev.index)
        if common.empty or np.abs(cur[common].to_numpy() - prev[common].to_numpy()).max() >= 1:
            break
        cur, n = prev, n + 1
    first = pd.Timestamp(pubs[i - n + 1], tz="UTC")
    return n, first


# ---------------------------------------------------------------- live (Tomorrow tab)

LIVE_TRAIN_DAYS = 30


def live_target_day(now: datetime) -> date:
    """Tomorrow in London: the day whose day-ahead auctions run today."""
    return now.astimezone(LONDON).date() + timedelta(days=1)


def live_fit(
    wf: pd.DataFrame, fh: pd.DataFrame, target: date, local: time, margin: int
) -> tuple[pd.DataFrame, DayFit]:
    """Same pipeline as the pilot, calibrated on the trailing 30 delivery days (target-31 .. target-2).

    Returns the target day's decision-run rows (with corrected) and its fit.
    """
    train_start = target - timedelta(days=LIVE_TRAIN_DAYS + 1)
    days = [train_start + timedelta(days=i) for i in range(LIVE_TRAIN_DAYS + 2)]
    frame = decision_frame(clean_windfor(wf), fh, days, local, margin)
    rows, fits = walk_forward(frame, [target], train_start)
    return rows, fits[target]
