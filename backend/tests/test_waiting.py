from datetime import date, time, timedelta

import pandas as pd
from conftest import RUN_TIMES, synth_data

from app import analysis as A

DAYS = [date(2026, 1, 14), date(2026, 1, 15), date(2026, 1, 16)]


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def test_slots_ids_and_count():
    assert len(A.SLOTS) == 16
    ids = [A.slot_id(o, t) for o, t in A.SLOTS]
    assert ids[0] == "d2_0230" and ids[-1] == "d1_2230" and len(set(ids)) == 16


def test_common_hours_are_the_d2_window():
    wf, fh = synth_data(DAYS)
    frames = A.slot_frames(A.clean_windfor(wf), A.hourly_actual(fh), DAYS)
    assert len(frames) == 16
    assert {len(f) for k, f in frames.items() if k.startswith("d1")} == {72}
    common = A.common_hours(frames)
    assert len(common) == 3 * 22  # D-2 runs end at 21:00 on D
    assert common.max() == ts("2026-01-16T21:00")


def test_common_hours_drop_missing_actuals():
    wf, fh = synth_data(DAYS)
    fh = fh[fh.startTime != ts("2026-01-15T05:00")]
    frames = A.slot_frames(A.clean_windfor(wf), A.hourly_actual(fh), DAYS)
    assert ts("2026-01-15T05:00") not in A.common_hours(frames)
    assert len(A.common_hours(frames)) == 3 * 22 - 1


def test_off_schedule_run_lands_in_its_slot():
    # On 15 Jan the 11:30 run was published at 12:25.
    wf, fh = synth_data(DAYS)
    late = wf.publishTime == ts("2026-01-15T11:30")
    wf = wf.assign(publishTime=wf.publishTime.mask(late, ts("2026-01-15T12:25")))
    frames = A.slot_frames(A.clean_windfor(wf), A.hourly_actual(fh), DAYS)
    d16 = frames["d1_1130"].query("day == @DAYS[2]")
    assert d16.publishTime.unique().tolist() == [ts("2026-01-15T12:25")]
    assert frames["d1_0930"].query("day == @DAYS[2]").publishTime.unique().tolist() == [
        ts("2026-01-15T09:30")
    ]


def test_late_run_is_in_its_slot_but_not_the_gate_run():
    # A 09:30 run published at 09:55 misses the 09:50 N2EX gate, though the 09:30 slot's grace holds it.
    wf, fh = synth_data(DAYS)
    late = wf.publishTime == ts("2026-01-15T09:30")
    wf = A.clean_windfor(wf.assign(publishTime=wf.publishTime.mask(late, ts("2026-01-15T09:55"))))
    slot = A.slot_frames(wf, A.hourly_actual(fh), DAYS)["d1_0930"].query("day == @DAYS[2]")
    gate = A.decision_frame(wf, fh, DAYS, A.AUCTIONS["n2ex"], 0).query("day == @DAYS[2]")
    assert slot.publishTime.unique().tolist() == [ts("2026-01-15T09:55")]
    assert gate.publishTime.unique().tolist() == [ts("2026-01-15T07:30")]


def test_gate_slots_match_decision_runs_on_snapshot(snapshot):
    # Pins the snapshot fact the waiting curve's gate labels rely on.
    wf, fh = A.clean_windfor(snapshot.windfor), snapshot.fuelhh
    slots = A.slot_frames(wf, A.hourly_actual(fh), A.DAYS)
    for auction, slot in (("epex", "d1_0730"), ("n2ex", "d1_0930")):
        decision = A.decision_frame(wf, fh, A.DAYS, A.AUCTIONS[auction], 0)
        pd.testing.assert_series_equal(
            slots[slot].groupby("day").publishTime.first(), decision.groupby("day").publishTime.first()
        )


def test_slot_takes_latest_run_when_one_is_missing():
    wf, fh = synth_data(DAYS, run_times=[t for t in RUN_TIMES if t != time(11, 30)])
    frames = A.slot_frames(A.clean_windfor(wf), A.hourly_actual(fh), DAYS)
    assert (frames["d1_1130"].publishTime.dt.hour == 9).all()


def test_persistence_uses_publish_time_not_start_time():
    _, fh = synth_data(DAYS, actual=lambda s: s.dt.hour * 100.0 + s.dt.minute)
    # 15 Jan: half-hours 10:00-11:30 arrived together at 12:25 (as in the real data)
    late = fh.startTime.between(ts("2026-01-15T10:00"), ts("2026-01-15T11:30"))
    fh = fh.assign(publishTime=fh.publishTime.mask(late, ts("2026-01-15T12:25")))
    assert A.persistence(fh, ts("2026-01-15T12:00")) == 930.0  # 09:30 HH, the latest *published*
    assert A.persistence(fh, ts("2026-01-15T12:26")) == 1130.0
    assert A.persistence(fh, ts("2026-01-15T10:00")) == 900.0  # 09:30 HH is published at exactly 10:00
    assert A.persistence(fh, ts("2020-01-01")) is None


def test_ceiling_known_before_cutoff():
    days = [date(2026, 1, 2) + timedelta(days=i) for i in range(10)]
    _, fh = synth_data(days, actual=lambda s: 1_000.0 + (s - ts("2026-01-01")).dt.total_seconds() / 3600)
    cut = ts("2026-01-09T09:20")
    # Rising actual: the ceiling is the last complete hour known before the cutoff (08:00, known 09:00).
    expected = 1_000 + (ts("2026-01-09T08:00") - ts("2026-01-01")).total_seconds() / 3600 + 0.25
    assert A.ceiling_known(fh, date(2026, 1, 2), cut) == expected
    assert A.ceiling_known(fh, date(2026, 1, 8), cut) is None  # warm-up: too little history
