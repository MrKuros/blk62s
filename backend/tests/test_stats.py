from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app import analysis as A


def toy_frame(n_days: int = 10, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = np.repeat([date(2026, 1, 1) + timedelta(days=i) for i in range(n_days)], 24)
    actual = rng.uniform(5_000, 15_000, len(days))
    err = rng.normal(-1_000, 800, len(days))
    return pd.DataFrame({"day": days, "actual": actual, "err": err})


def test_metrics_on_a_toy_array():
    m = A.metrics([1.0, -3.0, np.nan, 2.0], [10.0, 10.0, 10.0, np.nan])
    assert m["n"] == 2
    assert m["mae"] == 2.0 and m["bias"] == -1.0
    assert m["rmse"] == pytest.approx(np.sqrt(5))
    assert m["wape"] == pytest.approx(4 / 20)


def test_metrics_empty():
    assert A.metrics([], [])["n"] == 0


def test_day_sums_reproduce_metrics():
    f = toy_frame()
    s = A.day_sums(f)
    assert len(s) == 10 and s.index.is_monotonic_increasing
    idx = np.arange(10)[None, :]
    for stat in ("mae", "bias", "rmse", "wape"):
        assert A.boot_ci(s, stat, idx)[0] == pytest.approx(A.metrics(f.err, f.actual)[stat])


def test_bootstrap_is_deterministic_and_shaped():
    a, b = A.block_bootstrap_idx(31), A.block_bootstrap_idx(31)
    assert a.shape == (2000, 31)
    np.testing.assert_array_equal(a, b)
    assert not np.array_equal(a, A.block_bootstrap_idx(31, seed=1))
    assert a.min() >= 0 and a.max() <= 30


def test_bootstrap_blocks_are_contiguous():
    idx = A.block_bootstrap_idx(31, n_boot=50, block=3)
    blocks = idx[:, :30].reshape(50, 10, 3)  # the last column is a truncated block
    assert (np.diff(blocks, axis=2) == 1).all()
    assert idx[:, 30].max() <= 28  # a block start: blocks never run past the last day


def test_bootstrap_shorter_than_block():
    assert A.block_bootstrap_idx(2, n_boot=5).shape == (5, 2)


def test_boot_ci_brackets_the_point():
    s = A.day_sums(toy_frame(31))
    point, lo, hi = A.boot_ci(s, "mae", A.block_bootstrap_idx(31))
    assert lo < point < hi


def test_paired_difference_of_identical_inputs_is_zero():
    s = A.day_sums(toy_frame(31))
    assert A.boot_ci(s, "mae", A.block_bootstrap_idx(31), other=s.copy()) == (0.0, 0.0, 0.0)


def test_paired_needs_the_same_days():
    s = A.day_sums(toy_frame(31))
    with pytest.raises(ValueError, match="same days"):
        A.boot_ci(s, "mae", A.block_bootstrap_idx(31), other=s.iloc[1:])
