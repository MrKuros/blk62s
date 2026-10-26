import json
from datetime import date
from pathlib import Path

import numpy as np
import pytest
from conftest import synth_data
from pydantic import BaseModel

from app import schemas

FIXTURES = Path(__file__).parent / "fixtures" / "contract"
# The January views are checked against their golden files; only the rest need a hand-made fixture.
GOLDEN = Path(__file__).parent / "golden"
SOURCES = {
    "replay": GOLDEN / "replay_0112_epex_jan.json",
    "accuracy": GOLDEN / "accuracy_epex_jan.json",
    "firm": GOLDEN / "firm_epex_jan.json",
    "waiting": GOLDEN / "waiting.json",
}
MODELS: dict[str, type[BaseModel]] = {
    "meta": schemas.Meta,
    "replay": schemas.Replay,
    "accuracy": schemas.Accuracy,
    "firm": schemas.Firm,
    "waiting": schemas.Waiting,
    "live": schemas.Live,
    "health": schemas.Health,
}


def load(name: str) -> dict:
    return json.loads(SOURCES.get(name, FIXTURES / f"{name}.json").read_text())


def test_every_fixture_has_a_model():
    assert {p.stem for p in FIXTURES.glob("*.json")} | set(SOURCES) == set(MODELS)


@pytest.mark.parametrize("name", MODELS)
def test_fixture_round_trips(name: str):
    raw = load(name)
    model = MODELS[name].model_validate(raw)
    assert model.model_dump(mode="json") == raw


def test_fixture_shapes():
    meta, firm, replay = (
        schemas.Meta(**load("meta")),
        schemas.Firm(**load("firm")),
        schemas.Replay(**load("replay")),
    )
    assert len(meta.days) == 31 and len(meta.slots) == 16
    assert [d.day for d in firm.days] == meta.days
    for d in firm.days:
        assert len(d.raw) == len(d.corrected) == len(d.actual) == 24
        assert (d.q is None) == d.calibrating
        if d.q:
            assert np.all(np.diff(d.q) >= 0) and 0.2 < d.q[0] < d.q[-1] < 2
    assert all(len(r.values) == len(replay.hours) for r in replay.runs)
    assert schemas.Waiting(**load("waiting")).slots[0].id == meta.slots[0].id


def test_unknown_keys_are_rejected():
    with pytest.raises(ValueError, match="extra"):
        schemas.Health.model_validate({**load("health"), "surprise": 1})


def test_synth_data_shape():
    days = [date(2026, 3, 29), date(2026, 3, 30)]  # spans the spring clock change
    wf, fh = synth_data(days, forecast=lambda s, p: (s - p).dt.total_seconds() / 3600, actual=5_000.0)
    assert wf.groupby("publishTime").size().eq(73).all()
    assert wf.publishTime.nunique() == 8 * 3
    assert wf.generation.min() < 0 < wf.generation.max()  # lead hours: hindcast rows are kept
    assert len(fh) == 48 * 4 - 2  # four London days, one of them 23 hours
    assert (fh.publishTime - fh.startTime).eq(np.timedelta64(30, "m")).all()
