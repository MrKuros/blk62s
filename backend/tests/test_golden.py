"""Frozen view outputs on the bundled snapshot, plus the fixture for the frontend's firm-wind parity test.

Regenerate both after an intended change: UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py
"""

import json
import math
import os
from datetime import date
from pathlib import Path

import pytest

from app import analysis as A
from app import service

GOLDEN = Path(__file__).parent / "golden"
PARITY = Path(__file__).parents[2] / "frontend" / "src" / "lib" / "firm_parity.json"
UPDATE = os.environ.get("UPDATE_GOLDEN") == "1"

VIEWS = {
    "replay_0112_epex_jan": lambda: service.replay_view(date(2026, 1, 12), "epex", 0, "jan"),
    "replay_0128_n2ex_jan": lambda: service.replay_view(date(2026, 1, 28), "n2ex", 0, "jan"),
    "replay_0103_0030_m20_dec": lambda: service.replay_view(date(2026, 1, 3), "00:30", 20, "dec"),
    "accuracy_epex_jan": lambda: service.accuracy_view("epex", 0, "jan"),
    "accuracy_n2ex_m10_dec": lambda: service.accuracy_view("n2ex", 10, "dec"),
    "firm_epex_jan": lambda: service.firm_view("epex", 0, "jan"),
    "waiting": service.waiting_view,
}
PARITY_DAYS = [date(2026, 1, d) for d in (2, 5, 8, 12, 20, 28)]  # one calibrating day, 28 Jan included


def _close(a, b) -> bool:
    """Equal, with floats to 1e-9: unrounded fits (the parity fixture) differ in the last bits between
    BLAS kernels, so CPUs that pick different kernels must still agree."""
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(map(_close, a, b))
    if isinstance(a, float) and isinstance(b, int | float) and not isinstance(b, bool):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    return a == b


def _check(path: Path, actual: dict) -> None:
    if UPDATE:
        path.write_text(json.dumps(actual, indent=1, sort_keys=True) + "\n")
    assert path.exists(), f"{path.name} missing: run with UPDATE_GOLDEN=1"
    assert _close(json.loads(path.read_text()), actual), (
        f"{path.name} changed: rerun with UPDATE_GOLDEN=1 if intended"
    )


@pytest.mark.parametrize("name", VIEWS)
def test_view_matches_golden(name: str):
    GOLDEN.mkdir(exist_ok=True)
    _check(GOLDEN / f"{name}.json", VIEWS[name]().model_dump(mode="json"))


def _num(x: float) -> float | None:
    return None if math.isnan(x) else float(x)


def firm_parity() -> dict:
    """Unrounded inputs and analysis.coverage results, so the TS port can be held to 1e-9; plus the
    shipped path, the rounded /firm payload, with the full-month results at the risk presets."""
    out, fits = service.bundle(A.AUCTIONS["epex"], 0, "jan")
    out = out[out["day"].isin(PARITY_DAYS)]
    fits = {d: fits[d] for d in PARITY_DAYS}
    days = []
    for d in PARITY_DAYS:
        rows = out[out["day"] == d].set_index("startTime").reindex(A.delivery_hours(d))
        days.append(
            {
                "day": str(d),
                "calibrating": fits[d].calibrating,
                **{
                    k: [_num(v) for v in rows[c]]
                    for k, c in (("raw", "forecast"), ("corrected", "corrected"), ("actual", "actual"))
                },
                "q": None if fits[d].q is None else fits[d].q.tolist(),
            }
        )
    cases = [
        {"r": r, "exclude": ex, "coverage": A.coverage(out, fits, r, {date.fromisoformat(x) for x in ex})}
        for r in (1, 5, 10, 25, 50)
        for ex in ([], [str(A.EXCLUDED_DAY)])
    ]
    full, full_fits = service.bundle(A.AUCTIONS["epex"], 0, "jan")
    payload = {
        "days": service.firm_view("epex", 0, "jan").model_dump(mode="json")["days"],
        "cases": [{"r": r, "exclude": [], "coverage": A.coverage(full, full_fits, r)} for r in (10, 5, 50)],
    }
    return {"days": days, "cases": cases, "payload": payload}


def test_firm_parity_fixture_is_current():
    parity = firm_parity()
    assert any(d["calibrating"] for d in parity["days"]) and not all(d["calibrating"] for d in parity["days"])
    _check(PARITY, parity)
