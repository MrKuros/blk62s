from datetime import date

import numpy as np
import pandas as pd
import pytest
from conftest import synth_data

from app import analysis as A
from app import signals as S

DAY = date(2026, 1, 12)
HOURS = A.delivery_hours(DAY)
PREV_PUB = pd.Timestamp("2026-01-11T04:30", tz="UTC")
FIT = A.DayFit(DAY, 9, False, 500.0, 0.8, np.linspace(0.5, 1.5, 99))
WARM = A.DayFit(DAY, 3, True, None, None, None)


def day_frame(forecast: float | np.ndarray, corrected: float | np.ndarray | None = None) -> pd.DataFrame:
    f = np.broadcast_to(np.asarray(forecast, dtype=float), len(HOURS))
    return pd.DataFrame(
        {"startTime": HOURS, "forecast": f, "corrected": f if corrected is None else corrected}
    )


def prev_run(values: float) -> pd.DataFrame:
    return pd.DataFrame({"startTime": HOURS, "publishTime": PREV_PUB, "generation": values})


def ids(signals: tuple) -> list[str]:
    head, watch = signals
    return ([head["id"]] if head else []) + [s["id"] for s in watch]


def test_quiet_day_has_no_signals():
    assert S.day_signals(day_frame(10_000), prev_run(10_100), FIT, 17_000) == (None, [])


def test_above_ceiling():
    f = np.full(len(HOURS), 15_000.0)
    f[:7] = 18_500
    sig = S.above_ceiling(day_frame(f), 17_756.4)
    assert sig == {"id": "above_ceiling", "params": {"hours": 7, "ceiling_mw": 17756}}
    assert S.above_ceiling(day_frame(f), None) is None
    assert S.above_ceiling(day_frame(17_756.0), 17_756.0) is None  # equal is not above


@pytest.mark.parametrize(
    ("prev", "fires"), [(11_000.0, True), (9_000.0, True), (10_999.0, False), (9_001.0, False)]
)
def test_revision_threshold(prev: float, fires: bool):
    sig = S.revision(day_frame(10_000), prev_run(prev))
    assert (sig is not None) == fires
    if fires:
        assert sig["params"] == {"delta_mw": round(10_000 - prev), "prev_publish": "2026-01-11T04:30:00Z"}


def test_revision_uses_only_overlapping_hours():
    prev = prev_run(5_000.0).iloc[:2]  # a D-2 style run covering two hours
    assert S.revision(day_frame(10_000), prev)["params"]["delta_mw"] == 5_000
    assert S.revision(day_frame(10_000), None) is None
    assert S.revision(day_frame(10_000), prev.iloc[:0]) is None


def test_correction_threshold_and_sign():
    assert S.correction(day_frame(10_000, 8_900), FIT) == {"id": "correction", "params": {"mw": 1100}}
    assert S.correction(day_frame(10_000, 9_100), FIT) is None
    assert S.correction(day_frame(10_000, 11_500), FIT) is None  # correction raised the forecast
    assert S.correction(day_frame(10_000, 8_000), WARM) is None


def test_calibrating():
    assert S.calibrating(WARM) == {"id": "calibrating", "params": {"train_days": 3}}
    assert S.calibrating(FIT) is None


def test_run_jump_needs_three_identical_runs():
    since = pd.Timestamp("2026-01-26T18:30", tz="UTC")
    assert S.run_jump((5, since)) == {
        "id": "run_jump",
        "params": {"runs": 5, "since": "2026-01-26T18:30:00Z"},
    }
    assert S.run_jump((2, since)) is None
    assert S.run_jump(None) is None


def test_priority_and_watch_list():
    f = np.full(len(HOURS), 19_000.0)
    out = S.day_signals(day_frame(f, f - 2_000), prev_run(17_000), FIT, 17_000, stale=(4, PREV_PUB))
    assert ids(out) == ["run_jump", "above_ceiling", "revision", "correction"]
    out = S.day_signals(day_frame(f), prev_run(19_000), WARM, 17_000)
    assert ids(out) == ["above_ceiling", "calibrating"]


def test_unchanged_runs_counts_repeated_runs():
    wf, _ = synth_data([date(2026, 1, 28)], forecast=lambda s, p: 10_000.0 + (p.dt.hour * 7).to_numpy())
    wf = A.clean_windfor(wf)
    pubs = sorted(wf.publishTime.unique())
    assert A.unchanged_runs(wf, pubs[5]) == (1, pubs[5])
    frozen = wf.publishTime.isin(pubs[4:8])  # four runs carry the values of pubs[3]
    base = wf[wf.publishTime == pubs[3]].set_index("startTime")["generation"]
    wf = wf.assign(generation=wf.generation.mask(frozen, wf.startTime.map(base)))
    wf = wf.dropna()
    assert A.unchanged_runs(wf, pubs[7]) == (5, pubs[3])
    assert A.unchanged_runs(wf, pubs[0]) == (1, pubs[0])


def test_28_jan_is_flagged_before_the_gate(snapshot):
    wf = A.clean_windfor(snapshot.windfor)
    for cutoff in ("epex", "n2ex"):
        run = A.run_for_day(wf, A.EXCLUDED_DAY, A.cutoff_utc(A.EXCLUDED_DAY, A.parse_cutoff(cutoff)))
        n, since = A.unchanged_runs(wf, run.publishTime.iloc[0])
        assert n >= S.STALE_RUNS and since == pd.Timestamp("2026-01-26T18:30", tz="UTC")
    # ...and no other January decision run at either gate looks like that
    for day in A.DAYS:
        if day != A.EXCLUDED_DAY:
            run = A.run_for_day(wf, day, A.cutoff_utc(day, A.AUCTIONS["epex"]))
            assert A.unchanged_runs(wf, run.publishTime.iloc[0])[0] < S.STALE_RUNS
