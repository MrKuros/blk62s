"""View builders: run the pure analysis on the bundled snapshot and shape it into the API contract.

Every January view is a deterministic function of (snapshot, params), so each is lru-cached and MW are
rounded to integers and ratios to 4 dp here: the golden files stay stable and payloads stay small.
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache, wraps

import numpy as np
import pandas as pd

from app import __version__, data, signals
from app import analysis as A
from app import schemas as S

log = logging.getLogger("firmwind.service")

PRESET_RS = (10, 5)  # the "1 in 10" and "1 in 20" risk presets, for the CSV exports
GAIN_FROM = {"epex": "d2_0730", "n2ex": "d2_0930"}  # same clock time on D-2 as each gate's run


def once[F: Callable](maxsize: int) -> Callable[[F], F]:
    """lru_cache that computes each cold entry once: requests fired in parallel by the page would
    otherwise all miss and rebuild the same bundle side by side under the GIL.

    ponytail: one lock per function, so a warm hit can wait behind another key's cold build (< 0.5 s).
    """

    def wrap(fn: F) -> F:
        cached, lock = lru_cache(maxsize)(fn), threading.Lock()

        @wraps(fn)
        def inner(*args):
            with lock:
                return cached(*args)

        return inner  # type: ignore[return-value]

    return wrap


# ---------------------------------------------------------------- rounding


def mw(x: float | None) -> float | None:
    return None if x is None or math.isnan(x) else float(round(x))


def ratio(x: float) -> float:
    return round(float(x), 4)


def ci(t: tuple[float, float, float], f=mw) -> S.CI:
    return S.CI(value=f(t[0]), lo=f(t[1]), hi=f(t[2]))


def _ts(t: pd.Timestamp | None) -> datetime | None:
    return None if t is None or pd.isna(t) else t.to_pydatetime()


def _aligned(rows: pd.DataFrame, col: str, hours: pd.DatetimeIndex) -> list[float | None]:
    return [mw(v) for v in rows.set_index("startTime")[col].reindex(hours).to_numpy(dtype=float)]


# ---------------------------------------------------------------- inputs + bundles


@once(1)
def _inputs() -> tuple[pd.DataFrame, pd.DataFrame, str, str]:
    snap = data.load_snapshot()
    return A.clean_windfor(snap.windfor), snap.fuelhh, snap.hash, snap.fetched_at


@once(1)
def _actual() -> pd.Series:
    return A.hourly_actual(_inputs()[1])


@once(16)
def _frame(local: time, margin: int) -> pd.DataFrame:
    """Decision runs from 1 Dec, so the December calibration has its history."""
    wf, fh, *_ = _inputs()
    return A.decision_frame(wf, fh, A.HISTORY_DAYS, local, margin)


@once(32)
def bundle(local: time, margin: int, calib: A.Calib) -> tuple[pd.DataFrame, dict[date, A.DayFit]]:
    """Walk-forward rows and fits for the January delivery days."""
    return A.walk_forward(_frame(local, margin), A.DAYS, A.TRAIN_START[calib])


def _boot(sums: pd.DataFrame, stat: A.Stat, other: pd.DataFrame | None = None) -> tuple[float, float, float]:
    return A.boot_ci(sums, stat, A.block_bootstrap_idx(len(sums)), other)


def _params(cutoff: str, margin: int, calib: A.Calib, day: date | None = None) -> S.Params:
    return S.Params(
        cutoff=cutoff, cutoff_local=f"{A.parse_cutoff(cutoff):%H:%M}", margin=margin, calib=calib, day=day
    )


def _calibration(fit: A.DayFit) -> S.Calibration:
    return S.Calibration(
        status="calibrating" if fit.calibrating else "ok",
        train_days=fit.train_days,
        train_window=fit.train_window,
        a=None if fit.a is None else ratio(fit.a),
        b=None if fit.b is None else ratio(fit.b),
        q=None if fit.q is None else [ratio(v) for v in fit.q],
    )


def _run_info(rows: pd.DataFrame) -> S.RunInfo | None:
    if rows.empty:
        return None
    return S.RunInfo(
        publish_time=_ts(rows["publishTime"].iloc[0]),
        hours_ahead_min=round(float(rows["lead_h"].min()), 2),
        hours_ahead_max=round(float(rows["lead_h"].max()), 2),
        n_hours=len(rows),
    )


def _source() -> S.SourceStatus:
    return S.SourceStatus(**data.source_status())


# ---------------------------------------------------------------- meta


def meta_view() -> S.Meta:
    _, _, h, fetched_at = _inputs()
    return S.Meta(
        version=__version__,
        data_hash=h,
        snapshot_fetched_at=fetched_at,
        source=_source(),
        days=A.DAYS,
        auctions=[
            S.Auction(id=k, label=f"{k.upper()} {t:%H:%M}", local_time=f"{t:%H:%M}")
            for k, t in A.AUCTIONS.items()
        ],
        margins=[0, 10, 20, 60],
        slots=[S.Slot(id=A.slot_id(o, t), day_offset=o, local_time=f"{t:%H:%M}") for o, t in A.SLOTS],
        excluded_day=A.EXCLUDED_DAY,
    )


# ---------------------------------------------------------------- replay


@once(256)
def replay_view(day: date, cutoff: str, margin: int, calib: A.Calib) -> S.Replay:
    """`day` must be one of A.DAYS; the route checks it."""
    wf, fh, h, _ = _inputs()
    local = A.parse_cutoff(cutoff)
    cut = A.cutoff_utc(day, local, margin)
    out, fits = bundle(local, margin, calib)
    rows, fit = out[out["day"] == day], fits[day]
    hours = A.delivery_hours(day)

    # Every run published D-2 00:00 .. D-1 23:59 local, flagged when it missed the cutoff.
    window = wf[
        (wf["publishTime"] >= A.local_utc(day - timedelta(days=2), time(0)))
        & (wf["publishTime"] < A.local_utc(day, time(0)))
    ]
    runs = [
        S.ReplayRun(publish_time=_ts(pub), too_late=bool(pub >= cut), values=_aligned(g, "generation", hours))
        for pub, g in window.groupby("publishTime")
    ]

    head, watch = None, []
    if not rows.empty:
        pub = rows["publishTime"].iloc[0]
        head, watch = signals.day_signals(
            rows,
            A.run_for_day(wf, day, pub),
            fit,
            A.ceiling_known(fh, A.TRAIN_START[calib], cut),
            A.unchanged_runs(wf, pub),
        )

    gate = {a: A.run_for_day(wf, day, A.cutoff_utc(day, t, margin)) for a, t in A.AUCTIONS.items()}
    diff = (
        gate["n2ex"].set_index("startTime")["generation"] - gate["epex"].set_index("startTime")["generation"]
    )
    return S.Replay(
        data_hash=h,
        params=_params(cutoff, margin, calib, day),
        decision_run=_run_info(rows),
        hours=[
            S.ReplayHour(t=t, raw=raw, corrected=c, actual=a)
            for t, raw, c, a in zip(
                hours.to_pydatetime(),
                _aligned(rows, "forecast", hours),
                _aligned(rows, "corrected", hours),
                _aligned(rows, "actual", hours),
                strict=True,
            )
        ],
        runs=runs,
        calibration=_calibration(fit),
        persistence_mw=mw(A.persistence(fh, cut)),
        kpis=S.ReplayKpis(
            forecast_avg_mw=mw(rows["forecast"].mean()) if len(rows) else None,
            forecast_peak_mw=mw(rows["forecast"].max()) if len(rows) else None,
            correction_avg_mw=None
            if fit.calibrating or rows.empty
            else mw((rows["corrected"] - rows["forecast"]).mean()),
        ),
        auction_compare=S.ReplayAuctionCompare(
            epex_publish_time=_ts(gate["epex"]["publishTime"].iloc[0]) if len(gate["epex"]) else None,
            n2ex_publish_time=_ts(gate["n2ex"]["publishTime"].iloc[0]) if len(gate["n2ex"]) else None,
            mean_diff_mw=mw(diff.mean()) if diff.notna().any() else None,
        ),
        signal=head,
        watch=watch,
    )


# ---------------------------------------------------------------- accuracy


def _metrics(frame: pd.DataFrame) -> dict[str, float]:
    return A.metrics(frame["err"], frame["actual"])


@once(32)
def accuracy_view(cutoff: str, margin: int, calib: A.Calib) -> S.Accuracy:
    wf, fh, h, _ = _inputs()
    local = A.parse_cutoff(cutoff)
    out, fits = bundle(local, margin, calib)
    scored = out[out["err"].notna()]
    m = _metrics(scored)
    sums = A.day_sums(scored)
    b, a = np.polyfit(scored["forecast"], scored["actual"], 1)

    fitted = scored[~scored["calibrating"]]
    raw_s, cor_s = A.day_sums(fitted, "err"), A.day_sums(fitted, "cerr")

    per_day = scored.groupby("day").agg(
        mean_forecast_mw=("forecast", "mean"),
        mean_actual_mw=("actual", "mean"),
        raw_mae=("err", lambda e: e.abs().mean()),
        raw_bias=("err", "mean"),
        corrected_mae=("cerr", lambda e: e.abs().mean()),
    )
    days = [
        S.AccuracyDay(
            day=d,
            mean_forecast_mw=mw(r.mean_forecast_mw),
            mean_actual_mw=mw(r.mean_actual_mw),
            raw_mae=mw(r.raw_mae),
            raw_bias=mw(r.raw_bias),
            corrected_mae=None if fits[d].calibrating else mw(r.corrected_mae),
        )
        for d, r in per_day.iterrows()
    ]

    sensitivity = [S.SensitivityRow(alignment="hour_mean", mae=mw(m["mae"]), bias=mw(m["bias"]))]
    for how in ("hh_start", "centred"):
        sm = _metrics(A.decision_frame(wf, fh, A.DAYS, local, margin, how))
        sensitivity.append(S.SensitivityRow(alignment=how, mae=mw(sm["mae"]), bias=mw(sm["bias"])))

    # Persistence: the last delivered half-hour known at the cutoff, held flat over the day.
    flat = scored["day"].map({d: A.persistence(fh, A.cutoff_utc(d, local, margin)) for d in A.DAYS})
    persistence_mae = (scored["actual"] - flat.astype(float)).abs().mean()
    # D-2 baseline: the run available at the same clock time a day earlier, on the hours it covers.
    d2 = A.frame_for_cutoffs(
        wf, _actual(), A.DAYS, [A.cutoff_utc(d - timedelta(days=1), local, margin) for d in A.DAYS]
    )
    d2 = d2[d2["err"].notna()]
    same = scored[scored["startTime"].isin(d2["startTime"])]

    gates = {k: bundle(t, margin, calib)[0] for k, t in A.AUCTIONS.items()}
    gate_sums = {k: A.day_sums(f) for k, f in gates.items()}

    return S.Accuracy(
        data_hash=h,
        params=_params(cutoff, margin, calib),
        n_hours=m["n"],
        n_days=len(sums),
        mae=ci(_boot(sums, "mae")),
        bias=ci(_boot(sums, "bias")),
        wape=ci(_boot(sums, "wape"), ratio),
        rmse=mw(m["rmse"]),
        over_share=ratio((scored["err"] < 0).mean()),
        corr=ratio(np.corrcoef(scored["forecast"], scored["actual"])[0, 1]),
        ols=S.Ols(a=ratio(a), b=ratio(b)),
        corrected=S.CorrectedEffect(
            n_days=len(raw_s),
            raw_mae=ci(_boot(raw_s, "mae")),
            corrected_mae=ci(_boot(cor_s, "mae")),
            gain=ci(_boot(cor_s, "mae", raw_s)),
        ),
        by_level=[
            S.LevelBin(
                **{k: mw(v) if k.startswith(("raw_", "corr_")) else v for k, v in row.items() if k != "bias"}
            )
            # Fitted days only, so raw and corrected percentiles describe the same hours.
            for row in A.level_table(scored[~scored["calibrating"]])
        ],
        ceiling_mw=mw(scored["actual"].max()),
        days=days,
        sensitivity=sensitivity,
        baselines=S.Baselines(
            persistence_mae=mw(persistence_mae),
            d2_mae=mw(_metrics(d2)["mae"]),
            d2_decision_mae=mw(_metrics(same)["mae"]),
            d2_n_hours=len(d2),
        ),
        auction_compare=S.AccuracyAuctionCompare(
            epex_mae=mw(_metrics(gates["epex"])["mae"]),
            n2ex_mae=mw(_metrics(gates["n2ex"])["mae"]),
            diff=ci(_boot(gate_sums["n2ex"], "mae", gate_sums["epex"])),
        ),
    )


# ---------------------------------------------------------------- firm


@once(32)
def firm_view(cutoff: str, margin: int, calib: A.Calib) -> S.Firm:
    h = _inputs()[2]
    local = A.parse_cutoff(cutoff)
    out, fits = bundle(local, margin, calib)
    by_day = dict(tuple(out.groupby("day")))
    days = []
    for d in A.DAYS:
        rows, hours, fit = by_day.get(d, out.iloc[:0]), A.delivery_hours(d), fits[d]
        days.append(
            S.FirmDay(
                day=d,
                calibrating=fit.calibrating,
                raw=_aligned(rows, "forecast", hours),
                corrected=_aligned(rows, "corrected", hours),
                actual=_aligned(rows, "actual", hours),
                q=None if fit.q is None else [ratio(v) for v in fit.q],
            )
        )
    methods = [
        S.MethodRow(
            **{k: v for k, v in row.items() if k != "shortfall_gwh"}
            | {k: ratio(row[k]) for k in ("hour_cov", "day_cov", "firm_pct")}
        )
        for row in A.method_table(_frame(local, margin), out, fits, A.TRAIN_START[calib])
    ]
    return S.Firm(data_hash=h, params=_params(cutoff, margin, calib), days=days, methods=methods)


# ---------------------------------------------------------------- waiting


@once(1)
def waiting_view() -> S.Waiting:
    """Every publish slot, scored on the hours all slots and both gate runs cover (margin 0).

    Gate runs come from the decision frames, not the d1_0730 / d1_0930 slots: a slot's 59-minute grace
    reaches past the gate, so a late 09:30 run would sit in its slot yet miss N2EX. `last_slot_id` names
    the slot whose nominal time is the last before the gate; on the snapshot it holds the same runs.
    """
    wf, _, h, _ = _inputs()
    slots = A.slot_frames(wf, _actual(), A.DAYS)
    gates = {k: bundle(t, 0, "jan")[0] for k, t in A.AUCTIONS.items()}
    common = A.common_hours({**slots, **gates})
    sums = {k: A.day_sums(f[f["startTime"].isin(common)]) for k, f in {**slots, **gates}.items()}

    def post(offset: int, t: time, gate: time) -> bool:
        return offset == -1 and t >= gate

    rows = []
    for offset, t in A.SLOTS:
        sid = A.slot_id(offset, t)
        f = slots[sid]
        m = _metrics(f[f["startTime"].isin(common)])
        rows.append(
            S.WaitingSlot(
                id=sid,
                day_offset=offset,
                local_time=f"{t:%H:%M}",
                mae=ci(_boot(sums[sid], "mae")),
                bias=mw(m["bias"]),
                rmse=mw(m["rmse"]),
                n_hours=m["n"],
                post_gate=S.PostGate(**{k: post(offset, t, g) for k, g in A.AUCTIONS.items()}),
            )
        )
    last = {
        k: A.slot_id(*max((o, t) for o, t in A.SLOTS if o == -1 and t < g)) for k, g in A.AUCTIONS.items()
    }
    return S.Waiting(
        data_hash=h,
        common_hours=len(common),
        slots=rows,
        gates=[
            S.Gate(auction=k, local_time=f"{g:%H:%M}", last_slot_id=last[k]) for k, g in A.AUCTIONS.items()
        ],
        gains=[
            S.Gain(
                auction=k,
                from_slot=GAIN_FROM[k],
                to_slot=last[k],
                diff=ci(_boot(sums[k], "mae", sums[GAIN_FROM[k]])),
            )
            for k in A.AUCTIONS
        ],
        auction_diff=ci(_boot(sums["n2ex"], "mae", sums["epex"])),
    )


# ---------------------------------------------------------------- live


_live_lock = threading.Lock()


def live_view(cutoff: str, margin: int, now: datetime | None = None) -> S.Live:
    """Tomorrow, on live Elexon data, calibrated on the trailing 30 days. Never raises on data problems:
    the January pilot must not depend on Elexon being up."""
    now = now or datetime.now(UTC)
    local = A.parse_cutoff(cutoff)
    target = A.live_target_day(now)
    cut = A.cutoff_utc(target, local, margin)
    passed = pd.Timestamp(now) >= cut
    base = {
        "target_day": target,
        "params": _params(cutoff, margin, "jan", target),
        "cutoff_utc": _ts(cut),
        "gate_passed": passed,
    }
    try:
        with _live_lock:  # the first caller fetches (~15 s cold); the rest wait for its cached result
            # Once the gate has passed, data fetched before it may lack the run the gate used.
            wf, fh, fetched_at = data.live_inputs(now, fresh_from=cut.to_pydatetime() if passed else None)
        rows, fit = A.live_fit(wf, fh, target, local, margin)
    except Exception:  # Elexon down, or a payload the pipeline cannot use
        log.warning("live view unavailable", exc_info=True)
        return S.Live(status="unavailable", message="Elexon could not be reached just now.", hours=[], **base)
    hours = A.delivery_hours(target)
    return S.Live(
        status="ok",
        fetched_at=fetched_at,
        decision_run=_run_info(rows),
        latest_publish_time=_ts(wf["publishTime"].max()) if len(wf) else None,
        hours=[
            S.LiveHour(t=t, raw=raw, corrected=c)
            for t, raw, c in zip(
                hours.to_pydatetime(),
                _aligned(rows, "forecast", hours),
                _aligned(rows, "corrected", hours),
                strict=True,
            )
        ],
        calibration=_calibration(fit),
        **base,
    )


# ---------------------------------------------------------------- CSV export


def export_rows(
    view: S.ExportView, cutoff: str, margin: int, calib: A.Calib, day: date | None = None
) -> tuple[list[str], list[str], list[Sequence]]:
    """(receipt comment lines, header, rows) for the CSV download of a view."""
    local = A.parse_cutoff(cutoff)
    if view == "waiting":  # the waiting curve is fixed at the auction gates, margin 0
        cutoff_desc, margin, calib = "epex+n2ex gates", 0, "jan"
    else:
        cutoff_desc = f"{cutoff} ({local:%H:%M} Europe/London, D-1)"
    run_used = "latest run published before each day's cutoff"

    def firm_cols(c: float | None, q: list[float] | None) -> list[float | None]:
        return [None if q is None or c is None else mw(float(A.firm(c, np.asarray(q), k))) for k in PRESET_RS]

    if view == "replay":
        assert day is not None, "the route requires day for view=replay"
        r = replay_view(day, cutoff, margin, calib)
        run_used = r.decision_run.publish_time.isoformat() if r.decision_run else "none"
        q = r.calibration.q
        header = ["hour_start_utc", "raw_mw", "corrected_mw", "actual_mw"] + [
            f"firm_r{k}_mw" for k in PRESET_RS
        ]
        rows = [[x.t.isoformat(), x.raw, x.corrected, x.actual, *firm_cols(x.corrected, q)] for x in r.hours]
    elif view == "accuracy":
        a = accuracy_view(cutoff, margin, calib)
        header = list(S.AccuracyDay.model_fields)
        rows = [[getattr(d, k) for k in header] for d in a.days]
    elif view == "firm":
        f = firm_view(cutoff, margin, calib)
        header = ["day", "hour_start_utc", "calibrating", "raw_mw", "corrected_mw", "actual_mw"] + [
            f"firm_r{k}_mw" for k in PRESET_RS
        ]
        rows = []
        for d in f.days:
            for i, t in enumerate(A.delivery_hours(d.day)):
                c = d.corrected[i]
                rows.append(
                    [d.day, t.isoformat(), d.calibrating, d.raw[i], c, d.actual[i], *firm_cols(c, d.q)]
                )
    else:
        w = waiting_view()
        header = ["slot", "day_offset", "local_time", "mae_mw", "mae_lo", "mae_hi", "bias_mw", "rmse_mw"]
        header += ["n_hours", "post_gate_epex", "post_gate_n2ex"]
        rows = [
            [s.id, s.day_offset, s.local_time, s.mae.value, s.mae.lo, s.mae.hi, s.bias, s.rmse, s.n_hours]
            + [s.post_gate.epex, s.post_gate.n2ex]
            for s in w.slots
        ]

    receipt = [
        f"# view={view} cutoff={cutoff_desc} margin={margin} calib={calib}"
        + (f" day={day}" if view == "replay" else ""),
        f"# run_used={run_used}",
        f"# source={data.source_status()['state']} data_hash={_inputs()[2]} version={__version__}",
        "# error = actual - forecast (MW); negative means the forecast was too high",
    ]
    return receipt, header, rows
