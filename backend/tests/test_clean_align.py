from datetime import date, time

import numpy as np
import pandas as pd
import pytest
from conftest import synth_data

from app import analysis as A

DAY = date(2026, 1, 12)


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def minutes(start: pd.Series) -> np.ndarray:
    """Actual = minutes since midnight UTC, so every alignment has a known answer."""
    return (start.dt.hour * 60 + start.dt.minute).to_numpy(dtype=float)


def test_clean_drops_hindcast_rows():
    wf, _ = synth_data([DAY])
    clean = A.clean_windfor(wf)
    assert (wf.startTime < wf.publishTime).any()
    assert (clean.startTime >= clean.publishTime).all()
    assert len(clean) == (wf.startTime >= wf.publishTime).sum()


@pytest.mark.parametrize(("how", "at_10"), [("hour_mean", 615.0), ("hh_start", 600.0), ("centred", 585.0)])
def test_alignments(how: str, at_10: float):
    _, fh = synth_data([DAY], actual=minutes)
    assert A.hourly_actual(fh, how)[ts("2026-01-12T10:00")] == at_10


def test_hour_mean_is_nan_when_a_half_hour_is_missing():
    _, fh = synth_data([DAY], actual=minutes)
    fh = fh[fh.startTime != ts("2026-01-12T10:30")]
    s = A.hourly_actual(fh)
    assert np.isnan(s[ts("2026-01-12T10:00")])
    assert s[ts("2026-01-12T11:00")] == 675.0
    assert np.isnan(A.hourly_actual(fh, "centred")[ts("2026-01-12T11:00")])


def test_hourly_index_is_hour_starts():
    _, fh = synth_data([DAY])
    idx = A.hourly_actual(fh).index
    assert (idx.minute == 0).all() and idx.is_unique and idx.is_monotonic_increasing


def test_known_before_uses_publish_time():
    _, fh = synth_data([DAY], actual=minutes, fuel_lag=pd.Timedelta(minutes=30))
    cut = ts("2026-01-12T11:00")  # HH 10:00 published 10:30, HH 10:30 published exactly 11:00
    s = A.hourly_actual(fh, known_before=cut)
    assert s[ts("2026-01-12T09:00")] == 555.0
    assert np.isnan(s[ts("2026-01-12T10:00")])  # needs the 10:30 half-hour, not yet published
    assert s.index.max() == ts("2026-01-12T10:00")


def test_delivery_window_and_decision_frame():
    wf, fh = synth_data([DAY], forecast=12_000.0, actual=minutes)
    frame = A.decision_frame(A.clean_windfor(wf), fh, [DAY], A.AUCTIONS["epex"], 0)
    assert frame.startTime.tolist() == list(A.delivery_hours(DAY))
    assert (frame.publishTime == ts("2026-01-11T07:30")).all()
    assert frame.lead_h.tolist() == [16.5 + h for h in range(24)]
    np.testing.assert_allclose(frame.err, frame.actual - 12_000.0)
    assert (frame.known_at == frame.startTime + pd.Timedelta(hours=1)).all()
    assert (frame.cutoff == ts("2026-01-11T09:20")).all()


def test_d2_run_covers_22_hours():
    wf, fh = synth_data([DAY])
    frame = A.decision_frame(A.clean_windfor(wf), fh, [DAY], time(0, 30), 0)  # latest run: D-2 22:30
    assert (frame.publishTime == ts("2026-01-10T22:30")).all()
    assert len(frame) == 22 and frame.startTime.max() == ts("2026-01-12T21:00")
