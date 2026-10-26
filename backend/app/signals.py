"""Deterministic decision signals for one delivery day. Each rule returns {id, params} or None; the
frontend turns id + params into a sentence, so no text is generated here.

Every input is known before the cutoff: the decision run, the run before it, the day's walk-forward fit
and the highest delivered wind published before the cutoff.
"""

from __future__ import annotations

from typing import TypedDict

import pandas as pd

from app.analysis import DayFit

REVISION_MW = 1000
CORRECTION_MW = 1000
STALE_RUNS = 3  # the decision run repeats the two runs before it: no update for ~half a day


class Sig(TypedDict):
    id: str
    params: dict[str, float | int | str]


def _iso(t: pd.Timestamp) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def run_jump(stale: tuple[int, pd.Timestamp] | None) -> Sig | None:
    """The 28-Jan rule. The bad run was not detectable from its level or a revision (it matched the
    previous run exactly); what was visible before the gate is that the forecast had stopped updating."""
    if stale is None or stale[0] < STALE_RUNS:
        return None
    return {"id": "run_jump", "params": {"runs": stale[0], "since": _iso(stale[1])}}


def above_ceiling(day_frame: pd.DataFrame, ceiling_mw: float | None) -> Sig | None:
    if ceiling_mw is None:
        return None
    hours = int((day_frame["forecast"] > ceiling_mw).sum())
    return (
        {"id": "above_ceiling", "params": {"hours": hours, "ceiling_mw": round(ceiling_mw)}}
        if hours
        else None
    )


def revision(day_frame: pd.DataFrame, prev_run: pd.DataFrame | None) -> Sig | None:
    if prev_run is None or prev_run.empty:
        return None
    cur = day_frame.set_index("startTime")["forecast"]
    prev = prev_run.set_index("startTime")["generation"]
    delta = (cur - prev).dropna()
    if delta.empty or abs(delta.mean()) < REVISION_MW:
        return None
    return {
        "id": "revision",
        "params": {"delta_mw": round(delta.mean()), "prev_publish": _iso(prev_run["publishTime"].iloc[0])},
    }


def correction(day_frame: pd.DataFrame, fit: DayFit) -> Sig | None:
    if fit.calibrating or day_frame.empty:
        return None
    mw = (day_frame["forecast"] - day_frame["corrected"]).mean()
    return {"id": "correction", "params": {"mw": round(mw)}} if mw >= CORRECTION_MW else None


def calibrating(fit: DayFit) -> Sig | None:
    return {"id": "calibrating", "params": {"train_days": fit.train_days}} if fit.calibrating else None


def day_signals(
    day_frame: pd.DataFrame,
    prev_run: pd.DataFrame | None,
    fit: DayFit,
    ceiling_mw: float | None,
    stale: tuple[int, pd.Timestamp] | None = None,
) -> tuple[Sig | None, list[Sig]]:
    """(headline, watch list): the first rule that fires, in priority order, and the rest.

    day_frame: the day's walk_forward rows (forecast, corrected). prev_run: run_for_day rows of the run
    before the decision run. stale: analysis.unchanged_runs for the decision run.
    A frozen feed outranks everything else, because it means every other number is out of date.
    """
    fired = [
        s
        for s in (
            run_jump(stale),
            above_ceiling(day_frame, ceiling_mw),
            revision(day_frame, prev_run),
            correction(day_frame, fit),
            calibrating(fit),
        )
        if s is not None
    ]
    return (fired[0] if fired else None), fired[1:]
