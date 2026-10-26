# Research

These are the pre-build investigations behind the app: what the GB day-ahead gate times are, what the two Elexon datasets actually contain, and a first empirical pass over January 2026. They fixed the design choices recorded in [`docs/METHODOLOGY.md`](../METHODOLOGY.md) (default gate, strict `publishTime < cutoff`, hindcast drop, alignment, the over-forecast headline).

Exploratory numbers in these notes can differ slightly from the app, because the app's final method differs (EPEX 09:20 default gate instead of 09:50, walk-forward validation instead of leave-one-day-out). The authoritative numbers come from `scripts/story_numbers.py` and are reproduced in [final-numbers.md](final-numbers.md).

Claims that could not be confirmed against a primary source are marked **UNVERIFIED**. Sources are linked inline.

| File                                                       | What it is                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [market-timing.md](market-timing.md)                       | GB day-ahead auction gate closures (EPEX 09:20, N2EX 09:50, half-hourly auctions), which WINDFOR run each gate can use, and why 09:20 is the default.                                         |
| [elexon-data.md](elexon-data.md)                           | Semantics of WINDFOR and FUELHH (WIND): coverage, resolution, observed publish schedule vs the documented one, hindcast hours, API limits, and how to join them.                              |
| [january-2026-findings.md](january-2026-findings.md)       | Exploratory analysis of January 2026: data quality, alignment test, the systematic over-forecast that grows with level, error by lead time, firm-wind buffers, value of waiting, worst hours. |
| [final-numbers.md](final-numbers.md)                       | The app's final numbers, regenerated from the bundled snapshot with `scripts/story_numbers.py`.                                                                                               |
| [exploratory/fetch.py](exploratory/fetch.py)               | Fetches the January 2026 WINDFOR and FUELHH WIND data from the Elexon API into `exploratory/raw/` (git-ignored, cached).                                                                      |
| [exploratory/jan_analysis.py](exploratory/jan_analysis.py) | The pandas prototype behind `january-2026-findings.md`; prints its full output as markdown. Its logic was later ported, with walk-forward validation, into `backend/app/analysis.py`.         |

To reproduce the exploratory analysis from the repo root:

```bash
python3 -I docs/research/exploratory/fetch.py
uv run --project backend python -I docs/research/exploratory/jan_analysis.py > jan_output.md
```
