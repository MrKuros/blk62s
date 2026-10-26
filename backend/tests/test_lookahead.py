"""No-lookahead property test on the real snapshot.

For every January delivery day D, every cutoff (both auctions, an after-midnight, an afternoon and a
midnight custom time) and every latency margin:
- every forecast row used was published strictly before cutoff(D);
- training uses delivery days <= D-2 only, and only actuals published before cutoff(D);
- persistence and the delivered-wind ceiling use only FUELHH rows published before cutoff(D);
- perturbation: doubling every WINDFOR and FUELHH value published at or after cutoff(D), and adding a
  wild run published exactly at cutoff(D), leaves everything the replay shows for D unchanged.
The unperturbed side comes from the full-month walk-forward and the perturbed side from a frame that
stops at D, so the check also proves that a day's replay does not depend on any later day.
"""

from datetime import date, time, timedelta

import numpy as np
import pandas as pd
import pytest
from conftest import synth_data

from app import analysis as A
from app import signals as S

CUTOFFS = ["epex", "n2ex", "00:30", "14:30", "00:00"]
MARGINS = [0, 10, 20, 60]


@pytest.fixture(scope="module")
def clean(snapshot):
    return A.clean_windfor(snapshot.windfor), snapshot.fuelhh


def replay_core(wf, fh, rows: pd.DataFrame, fit: A.DayFit, cut: pd.Timestamp, calib: str) -> dict:
    """Everything the Replay view derives for the day of `rows` that must be knowable at the cutoff."""
    start, day = A.TRAIN_START[calib], fit.day
    pub = rows["publishTime"].iloc[0]
    ceiling = A.ceiling_known(fh, start, cut)
    head, watch = S.day_signals(rows, A.run_for_day(wf, day, pub), fit, ceiling, A.unchanged_runs(wf, pub))
    window = (A.local_utc(day - timedelta(days=2), time(0)), cut)
    early = wf[
        (wf.publishTime >= window[0])
        & (wf.publishTime < window[1])
        & wf.startTime.isin(A.delivery_hours(day))
    ]
    return {
        "publish": pub,
        "startTime": rows["startTime"].tolist(),
        "raw": rows["forecast"].to_numpy(),
        "corrected": rows["corrected"].to_numpy(),
        "fit": (fit.train_days, fit.calibrating, fit.a, fit.b, fit.train_window),
        "q": fit.q,
        "run_for_day": A.run_for_day(wf, day, cut)["generation"].to_numpy(),
        "persistence": A.persistence(fh, cut),
        "ceiling": ceiling,
        "signals": (head, watch),
        "early_runs": early.sort_values(["publishTime", "startTime"])["generation"].to_numpy(),
    }


def perturb(wf: pd.DataFrame, fh: pd.DataFrame, cut: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    late_wf, late_fh = wf.publishTime >= cut, fh.publishTime >= cut
    wild = wf[wf.publishTime == wf.loc[~late_wf, "publishTime"].max()].assign(publishTime=cut)
    wild = wild.assign(generation=wild.generation * 3)
    wf = pd.concat([wf.assign(generation=wf.generation.mask(late_wf, wf.generation * 2)), wild])
    wf = wf.drop_duplicates(["publishTime", "startTime"], keep="last")
    wf = wf.sort_values(["publishTime", "startTime"], ignore_index=True)
    return A.clean_windfor(wf), fh.assign(generation=fh.generation.mask(late_fh, fh.generation * 2))


def same(a, b) -> bool:
    if isinstance(a, np.ndarray) or isinstance(b, np.ndarray):
        return isinstance(a, np.ndarray) and isinstance(b, np.ndarray) and np.array_equal(a, b)
    return a == b


@pytest.mark.parametrize("margin", MARGINS)
@pytest.mark.parametrize("cutoff", CUTOFFS)
def test_no_lookahead(clean, cutoff: str, margin: int):
    wf, fh = clean
    local = A.parse_cutoff(cutoff)
    frame = A.decision_frame(wf, fh, A.HISTORY_DAYS, local, margin)
    full = {calib: A.walk_forward(frame, A.DAYS, A.TRAIN_START[calib]) for calib in ("jan", "dec")}
    for calib, (out, fits) in full.items():
        assert set(out.day) == set(A.DAYS)
        for day in A.DAYS:
            cut = A.cutoff_utc(day, local, margin)
            rows = out[out.day == day]
            assert (rows.publishTime < cut).all() and (rows.cutoff == cut).all()
            d2_run = rows.publishTime.iloc[0].date() == day - timedelta(days=2)  # cutoffs before 02:30
            assert len(rows) == (22 if d2_run else 24) and rows.startTime.isin(A.delivery_hours(day)).all()
            fit = fits[day]
            if fit.train_window:
                assert fit.train_window[0] >= A.TRAIN_START[calib]
                assert fit.train_window[1] <= day - timedelta(days=2)

    # Perturbation (January calibration everywhere, December too on the two auctions without margin)
    calibs = ("jan", "dec") if cutoff in A.AUCTIONS and margin == 0 else ("jan",)
    for day in A.DAYS:
        cut = A.cutoff_utc(day, local, margin)
        pwf, pfh = perturb(wf, fh, cut)
        pframe = A.decision_frame(pwf, pfh, [d for d in A.HISTORY_DAYS if d <= day], local, margin)
        for calib in calibs:
            out, fits = full[calib]
            base = replay_core(wf, fh, out[out.day == day], fits[day], cut, calib)
            prows, pfits = A.walk_forward(pframe, [day], A.TRAIN_START[calib])
            moved = replay_core(pwf, pfh, prows, pfits[day], cut, calib)
            diff = [k for k in base if not same(base[k], moved[k])]
            assert not diff, (
                f"{day} {cutoff} -{margin}min {calib}: {diff} changed after perturbing post-cutoff data"
            )


def test_perturbation_is_not_vacuous(clean):
    """The perturbation must actually move post-cutoff inputs, or the property test proves nothing."""
    wf, fh = clean
    day, local = date(2026, 1, 12), A.AUCTIONS["epex"]
    cut = A.cutoff_utc(day, local)
    pwf, pfh = perturb(wf, fh, cut)
    assert (
        A.run_for_day(pwf, day, cut + pd.Timedelta(seconds=1)).generation.sum()
        == 3 * A.run_for_day(wf, day, cut).generation.sum()
    )
    assert not A.hourly_actual(pfh).equals(A.hourly_actual(fh))
    # A pipeline that ignored the cutoff would see the change.
    leaky = A.decision_frame(pwf, pfh, [day], local, -24 * 60)
    honest = A.decision_frame(wf, fh, [day], local, -24 * 60)
    assert not np.array_equal(leaky.forecast, honest.forecast)


def test_training_drops_actuals_published_after_the_cutoff():
    """On schedule, D-2 actuals are all out by 00:00 on D-1. If FUELHH lags (here 36 h), D-2 is not known
    at the gate and must be left out of training even though the D-2 rule alone would allow it."""
    days = [date(2026, 1, 2) + timedelta(days=i) for i in range(12)]
    rng = np.random.default_rng(11)
    noise = rng.normal(0, 500, 24 * 40)
    t0 = pd.Timestamp("2025-12-25", tz="UTC")
    wf, fh = synth_data(
        days,
        forecast=lambda s, p: 8_000.0 + 100 * s.dt.hour.to_numpy(),
        actual=lambda s: 9_000 + noise[((s.dt.floor("h") - t0) // pd.Timedelta(hours=1)).to_numpy()],
        fuel_lag=timedelta(hours=36),
    )
    frame = A.decision_frame(A.clean_windfor(wf), fh, days, A.AUCTIONS["epex"], 0)
    day = days[-1]
    cut = A.cutoff_utc(day, A.AUCTIONS["epex"])
    honest = A.fit_day(frame, day, days[0], known_before=cut)
    naive = A.fit_day(frame, day, days[0])
    assert naive.train_window[1] == day - timedelta(days=2)
    assert honest.train_window[1] == day - timedelta(days=3)
    _, fits = A.walk_forward(frame, [day], days[0])  # walk_forward applies the filter itself
    assert fits[day].train_window == honest.train_window
