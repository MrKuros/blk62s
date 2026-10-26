from datetime import date, time

import pandas as pd
import pytest
from conftest import synth_data

from app import analysis as A


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        (date(2026, 3, 29), "2026-03-28T09:20"),  # D-1 is GMT, D is the short day
        (date(2026, 3, 30), "2026-03-29T08:20"),  # D-1 is the first BST day
        (date(2025, 10, 26), "2025-10-25T08:20"),  # D-1 still BST, D is the long day
        (date(2025, 10, 27), "2025-10-26T09:20"),  # D-1 back on GMT
    ],
)
def test_cutoff_is_london_local_on_d_minus_1(day: date, expected: str):
    assert A.cutoff_utc(day, A.AUCTIONS["epex"]) == ts(expected)


def test_margin_moves_cutoff_earlier():
    assert A.cutoff_utc(date(2026, 1, 12), time(9, 50), 20) == ts("2026-01-11T09:30")


@pytest.mark.parametrize(
    ("day", "n"), [(date(2026, 3, 29), 23), (date(2025, 10, 26), 25), (date(2026, 1, 12), 24)]
)
def test_delivery_hours_cover_the_local_day(day: date, n: int):
    hours = A.delivery_hours(day)
    assert len(hours) == n
    assert hours[0].tz_convert(A.LONDON).hour == 0 and hours[0].tz_convert(A.LONDON).date() == day
    assert (hours[-1] + pd.Timedelta(hours=1)).tz_convert(A.LONDON).hour == 0
    assert (hours.to_series().diff().dropna() == pd.Timedelta(hours=1)).all()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("epex", time(9, 20)), ("n2ex", time(9, 50)), ("00:30", time(0, 30)), ("23:59", time(23, 59))],
)
def test_parse_cutoff(raw: str, expected: time):
    assert A.parse_cutoff(raw) == expected


@pytest.mark.parametrize("raw", ["", "EPEX", "9:20", "24:00", "09:60", "09:20:00", " 09:20", "nordpool"])
def test_parse_cutoff_rejects(raw: str):
    with pytest.raises(ValueError, match="cutoff"):
        A.parse_cutoff(raw)


def test_run_at_exactly_the_cutoff_is_excluded():
    day = date(2026, 1, 12)
    wf, _ = synth_data([day], run_times=[time(7, 30), time(9, 20)])
    wf = A.clean_windfor(wf)
    cut = A.cutoff_utc(day, A.AUCTIONS["epex"])  # 2026-01-11 09:20Z, exactly the second run
    assert A.run_for_day(wf, day, cut).publishTime.unique().tolist() == [ts("2026-01-11T07:30")]
    later = A.run_for_day(wf, day, cut + pd.Timedelta(minutes=1))
    assert later.publishTime.unique().tolist() == [cut]


def test_run_one_minute_before_the_cutoff_is_included():
    day = date(2026, 1, 12)
    wf, _ = synth_data([day], run_times=[time(7, 30), time(9, 19)])
    run = A.run_for_day(A.clean_windfor(wf), day, A.cutoff_utc(day, A.AUCTIONS["epex"]))
    assert run.publishTime.unique().tolist() == [ts("2026-01-11T09:19")]
    assert len(run) == 24


def test_no_run_before_cutoff_gives_empty_frame():
    day = date(2026, 1, 12)
    wf, _ = synth_data([day])
    assert A.run_for_day(wf, day, ts("2020-01-01")).empty
