from datetime import UTC, date, datetime, time, timedelta

import numpy as np
import pandas as pd
import pytest
from conftest import synth_data

from app import analysis as A

T0 = pd.Timestamp("2025-05-01", tz="UTC")


def hour_ix(start: pd.Series) -> np.ndarray:
    return ((start.dt.floor("h") - T0) // pd.Timedelta(hours=1)).to_numpy()


def synthetic(n_days: int, level: np.ndarray, noise: np.ndarray, first: date = date(2025, 6, 3)):
    days = [first + timedelta(days=i) for i in range(n_days)]
    wf, fh = synth_data(
        days,
        forecast=lambda s, p: level[hour_ix(s)],
        actual=lambda s: level[hour_ix(s)] * noise[hour_ix(s)],
    )
    frame = A.decision_frame(A.clean_windfor(wf), fh, days, A.AUCTIONS["epex"], 0)
    return days, frame


@pytest.fixture(scope="module")
def iid_200():
    """200 days, hourly level-proportional noise that is independent across hours."""
    rng = np.random.default_rng(7)
    n = 24 * 260
    days, frame = synthetic(200, rng.uniform(3_000, 18_000, n), rng.lognormal(0, 0.15, n))
    return A.walk_forward(frame, days, days[0])


@pytest.mark.parametrize("r", [5, 10, 25])
def test_coverage_hits_target_out_of_sample(iid_200, r: int):
    out, fits = iid_200
    cov = A.coverage(out, fits, r)
    assert cov["n_days"] == 194  # the first 6 days are warm-up
    assert abs(cov["hour_cov"] - (1 - r / 100)) < 0.03


def test_firm_falls_as_accepted_shortfall_falls(iid_200):
    _, fits = iid_200
    q = fits[max(fits)].q
    assert np.all(np.diff(q) >= 0) and len(q) == 99
    f5, f10, f50 = (A.firm(10_000.0, q, r) for r in (5, 10, 50))
    assert f5 < f10 < f50


def test_firm_is_never_negative_and_validates_r():
    q = np.linspace(-0.5, 1.5, 99)
    assert A.firm(np.array([1_000.0, 5_000.0]), q, 1).tolist() == [0.0, 0.0]
    for r in (0, 51):
        with pytest.raises(ValueError):
            A.firm(1.0, q, r)


def test_correction_recovers_a_linear_bias():
    rng = np.random.default_rng(3)
    n = 24 * 60
    level = rng.uniform(4_000, 20_000, n)
    days = [date(2025, 6, 3) + timedelta(days=i) for i in range(20)]
    wf, fh = synth_data(
        days, forecast=lambda s, p: level[hour_ix(s)], actual=lambda s: 500 + 0.8 * level[hour_ix(s)]
    )
    frame = A.decision_frame(A.clean_windfor(wf), fh, days, A.AUCTIONS["epex"], 0)
    out, fits = A.walk_forward(frame, days, days[0])
    fit = fits[days[-1]]
    assert fit.a == pytest.approx(500, abs=1e-6) and fit.b == pytest.approx(0.8)
    assert fit.train_days == 18 and fit.train_window == (days[0], days[-3])
    np.testing.assert_allclose(fit.q, 1.0)
    fitted = out[~out.calibrating]
    np.testing.assert_allclose(fitted.cerr, 0, atol=1e-6)
    warm = out[out.calibrating]
    assert (warm.corrected == warm.forecast).all() and warm.day.nunique() == 6


def test_warmup_jan_vs_dec(snapshot):
    wf = A.clean_windfor(snapshot.windfor)
    frame = A.decision_frame(wf, snapshot.fuelhh, A.HISTORY_DAYS, A.AUCTIONS["epex"], 0)
    _, jan = A.walk_forward(frame, A.DAYS, A.TRAIN_START["jan"])
    _, dec = A.walk_forward(frame, A.DAYS, A.TRAIN_START["dec"])
    assert [d for d, f in jan.items() if f.calibrating] == A.DAYS[:6]
    assert jan[date(2026, 1, 8)].train_days == 5
    assert not any(f.calibrating for f in dec.values())
    assert dec[date(2026, 1, 2)].train_window == (date(2025, 12, 1), date(2025, 12, 31))


def test_exclude_28(snapshot):
    wf = A.clean_windfor(snapshot.windfor)
    frame = A.decision_frame(wf, snapshot.fuelhh, A.DAYS, A.AUCTIONS["epex"], 0)
    out, fits = A.walk_forward(frame, A.DAYS, A.TRAIN_START["jan"])
    full, ex = A.coverage(out, fits, 10), A.coverage(out, fits, 10, exclude={A.EXCLUDED_DAY})
    assert (full["n_days"], full["n_hours"]) == (25, 600)
    assert (ex["n_days"], ex["n_hours"]) == (24, 576)
    assert ex["hour_cov"] > full["hour_cov"]  # 28 Jan was a shortfall day


def test_method_table_and_per_level_fallback():
    # Mostly mid-level hours, a handful above 20 GW: that bin never reaches 30 training hours.
    rng = np.random.default_rng(5)
    n = 24 * 60
    level = rng.uniform(6_000, 9_000, n)
    level[::50] = 22_000
    days, frame = synthetic(15, level, rng.lognormal(0, 0.1, n))
    rows = A.method_table(frame, *A.walk_forward(frame, days, days[0]), days[0], rs=(10,))
    assert [(r["method"], r["exclude_28"]) for r in rows] == [
        (m, ex) for ex in (False, True) for m in ("ratio", "additive", "per_level")
    ]
    by = {(r["method"], r["exclude_28"]): r for r in rows}
    assert by[("per_level", False)]["fallback_bins"] > 0
    assert by[("ratio", False)]["fallback_bins"] == by[("additive", False)]["fallback_bins"] == 0
    assert all(r["n_days"] == 9 and 0.7 < r["hour_cov"] <= 1 for r in rows)


def test_level_table_bins():
    frame = pd.DataFrame(
        {
            "forecast": [1_000.0, 7_000.0, 7_500.0, 25_000.0],
            "err": [-100.0, -200.0, -300.0, -4_000.0],
            "cerr": [0.0, 10.0, 20.0, 30.0],
            "calibrating": [False, False, True, False],
        }
    )
    bins = A.level_table(frame)
    assert [b["n"] for b in bins] == [1, 2, 0, 0, 1]
    assert bins[1]["raw_p50"] == -250.0 and bins[1]["corr_p50"] == 10.0  # calibrating hour left out
    assert bins[2]["raw_p10"] is None and bins[4]["hi_mw"] is None


def test_live_target_day_is_tomorrow_in_london():
    assert A.live_target_day(datetime(2026, 3, 28, 23, 30, tzinfo=UTC)) == date(2026, 3, 29)
    assert A.live_target_day(datetime(2025, 10, 25, 23, 30, tzinfo=UTC)) == date(2025, 10, 27)  # 00:30 BST


def test_live_fit_uses_the_trailing_30_days(snapshot):
    target = date(2026, 1, 20)
    rows, fit = A.live_fit(snapshot.windfor, snapshot.fuelhh, target, A.AUCTIONS["epex"], 0)
    assert fit.train_days == 30 and fit.train_window == (date(2025, 12, 20), date(2026, 1, 18))
    assert len(rows) == 24 and (rows.publishTime < A.cutoff_utc(target, A.AUCTIONS["epex"])).all()
    assert rows.corrected.notna().all() and rows.day.eq(target).all()


def test_live_fit_with_no_data_is_calibrating(snapshot):
    rows, fit = A.live_fit(
        snapshot.windfor.iloc[:0], snapshot.fuelhh.iloc[:0], date(2026, 1, 20), time(9, 20), 0
    )
    assert rows.empty and fit.calibrating and fit.train_days == 0
