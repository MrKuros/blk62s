# Final numbers

These are the numbers the app shows, regenerated from the bundled snapshot with:

```bash
uv run --project backend python scripts/story_numbers.py
```

- Method: decision run = latest WINDFOR run published strictly before gate closure (EPEX 09:20 default, N2EX 09:50 alongside), walk-forward correction and firm-wind quantiles (each delivery day fitted only on days up to D-2), approximate 90% moving-block bootstrap CIs in brackets. Full method: [`docs/METHODOLOGY.md`](../METHODOLOGY.md).
- Sign: in these tables bias and error are **actual − forecast** (negative = forecast too high). The UI shows the same quantity with the opposite sign as **forecast bias = forecast − actual**.
- One heading is renamed from the script output ("Hook" → "Example day"); values are unchanged.
- Column labels: `epex`/`n2ex` = gate; `jan` = January-only calibration (default, 5-day warm-up), `dec` = with December 2025 history. `r` = accepted shortfall frequency (r = 10% is P90 wind).

Input: snapshot a1ce1e48b9bb, margin 0, delivery 2026-01-02 .. 2026-02-01.

## Headline, correction and firm wind (raw rows do not depend on calibration)

| Metric                                             | epex / jan                    | epex / dec                    | n2ex / jan                    | n2ex / dec                    |
| -------------------------------------------------- | ----------------------------- | ----------------------------- | ----------------------------- | ----------------------------- |
| Hours / days                                       | 744 / 31                      | 744 / 31                      | 744 / 31                      | 744 / 31                      |
| Typical miss, MAE (MW)                             | 2,039 [1,660, 2,458]          | 2,039 [1,660, 2,458]          | 2,013 [1,629, 2,441]          | 2,013 [1,629, 2,441]          |
| Bias, actual − forecast (MW)                       | −1,748 [−2,223, −1,265]       | −1,748 [−2,223, −1,265]       | −1,730 [−2,217, −1,241]       | −1,730 [−2,217, −1,241]       |
| WAPE                                               | 18.1% [15.0%, 21.5%]          | 18.1% [15.0%, 21.5%]          | 17.8% [14.7%, 21.4%]          | 17.8% [14.7%, 21.4%]          |
| RMSE (MW)                                          | 2,505                         | 2,505                         | 2,506                         | 2,506                         |
| Hours over-forecast                                | 84.9%                         | 84.9%                         | 84.3%                         | 84.3%                         |
| Days with negative bias                            | 27 / 31                       | 27 / 31                       | 28 / 31                       | 28 / 31                       |
| Correlation forecast vs actual                     | 0.931                         | 0.931                         | 0.931                         | 0.931                         |
| OLS actual = a + b·forecast (in-sample)            | 743 + 0.809·f                 | 743 + 0.809·f                 | 854 + 0.801·f                 | 854 + 0.801·f                 |
| Actual / forecast (sums)                           | 0.866                         | 0.866                         | 0.867                         | 0.867                         |
| Bias at <5 GW (n)                                  | −539 (31)                     | −539 (31)                     | −136 (31)                     | −136 (31)                     |
| Bias at 5–10 GW (n)                                | −770 (214)                    | −770 (214)                    | −796 (210)                    | −796 (210)                    |
| Bias at 10–15 GW (n)                               | −1,588 (201)                  | −1,588 (201)                  | −1,447 (206)                  | −1,447 (206)                  |
| Bias at 15–20 GW (n)                               | −2,367 (255)                  | −2,367 (255)                  | −2,423 (253)                  | −2,423 (253)                  |
| Bias at >20 GW (n)                                 | −4,562 (43)                   | −4,562 (43)                   | −4,653 (44)                   | −4,653 (44)                   |
| Fitted days (warm-up excluded)                     | 25                            | 31                            | 25                            | 31                            |
| Raw MAE on fitted days                             | 2,078 [1,664, 2,609]          | 2,039 [1,660, 2,458]          | 2,063 [1,652, 2,606]          | 2,013 [1,629, 2,441]          |
| Corrected MAE (walk-forward)                       | 1,309 [1,092, 1,569]          | 1,276 [1,145, 1,476]          | 1,288 [1,077, 1,542]          | 1,244 [1,112, 1,448]          |
| Gain: corrected − raw (paired)                     | −769 [−1,155, −435]           | −762 [−1,121, −354]           | −775 [−1,174, −440]           | −769 [−1,132, −360]           |
| Corrected bias                                     | −276                          | −148                          | −248                          | −155                          |
| Firm r=10% (all): hours / whole days covered       | 87.5% / 80.0% (n=600 h, 25 d) | 86.7% / 61.3% (n=744 h, 31 d) | 87.2% / 76.0% (n=600 h, 25 d) | 87.2% / 67.7% (n=744 h, 31 d) |
| Firm r=10% (ex 28 Jan): hours / whole days covered | 91.1% / 83.3% (n=576 h, 24 d) | 89.4% / 63.3% (n=720 h, 30 d) | 90.8% / 79.2% (n=576 h, 24 d) | 90.1% / 70.0% (n=720 h, 30 d) |
| Firm r=10%: firm as % of raw forecast              | 67.3%                         | 68.8%                         | 67.2%                         | 69.3%                         |
| Firm r=10%: shortfall vs firm (GWh, national)      | 103.3                         | 131.1                         | 105.0                         | 131.5                         |
| Firm r=5% (all): hours / whole days covered        | 93.0% / 84.0% (n=600 h, 25 d) | 89.8% / 83.9% (n=744 h, 31 d) | 92.7% / 84.0% (n=600 h, 25 d) | 89.8% / 80.6% (n=744 h, 31 d) |
| Firm r=5% (ex 28 Jan): hours / whole days covered  | 96.7% / 87.5% (n=576 h, 24 d) | 92.6% / 86.7% (n=720 h, 30 d) | 96.2% / 87.5% (n=576 h, 24 d) | 92.6% / 83.3% (n=720 h, 30 d) |
| Firm r=5%: firm as % of raw forecast               | 55.6%                         | 63.3%                         | 55.0%                         | 63.6%                         |
| Firm r=5%: shortfall vs firm (GWh, national)       | 46.6                          | 91.4                          | 42.4                          | 90.9                          |

## Delivered ceiling vs forecast

| Measure                                          | MW     |
| ------------------------------------------------ | ------ |
| Max hourly actual, delivery days                 | 17,756 |
| Max half-hour actual, 1–31 Jan                   | 17,805 |
| Max EPEX decision-run forecast                   | 21,064 |
| Max forecast in any run for the delivery hours   | 21,353 |
| Decision-run hours forecast above the max actual | 182    |

## EPEX (09:20, 07:30 run) vs N2EX (09:50, 09:30 run)

| Measure                                    | Value         |
| ------------------------------------------ | ------------- |
| Hours compared                             | 744           |
| Mean run difference, N2EX − EPEX (MW)      | −18           |
| Mean absolute run difference (MW)          | 209           |
| Days whose mean difference exceeds ±500 MW | 1             |
| MAE EPEX / N2EX (MW)                       | 2,039 / 2,013 |
| MAE difference, N2EX − EPEX (paired)       | −26 [−60, 20] |

## Value of waiting (common hours: 682)

| Slot          | MAE [90% CI]         | Bias   | RMSE  | n   |
| ------------- | -------------------- | ------ | ----- | --- |
| d2_0230       | 2,462 [1,893, 3,091] | −1,597 | 3,149 | 682 |
| d2_0430       | 2,508 [1,931, 3,174] | −1,672 | 3,208 | 682 |
| d2_0730       | 2,446 [1,922, 3,018] | −1,785 | 3,017 | 682 |
| d2_0930       | 2,484 [1,972, 3,044] | −1,924 | 3,038 | 682 |
| d2_1130       | 2,341 [1,889, 2,850] | −1,886 | 2,858 | 682 |
| d2_1530       | 2,242 [1,828, 2,727] | −1,826 | 2,720 | 682 |
| d2_1830       | 2,157 [1,785, 2,589] | −1,749 | 2,604 | 682 |
| d2_2230       | 2,119 [1,749, 2,527] | −1,794 | 2,590 | 682 |
| d1_0230       | 2,081 [1,696, 2,538] | −1,745 | 2,578 | 682 |
| d1_0430       | 2,020 [1,634, 2,474] | −1,673 | 2,515 | 682 |
| d1_0730       | 2,054 [1,675, 2,471] | −1,750 | 2,510 | 682 |
| d1_0930       | 2,025 [1,643, 2,447] | −1,728 | 2,511 | 682 |
| d1_1130       | 1,904 [1,549, 2,267] | −1,688 | 2,361 | 682 |
| d1_1530       | 1,882 [1,503, 2,233] | −1,711 | 2,330 | 682 |
| d1_1830       | 1,888 [1,502, 2,246] | −1,693 | 2,338 | 682 |
| d1_2230       | 1,820 [1,448, 2,184] | −1,586 | 2,276 | 682 |
| EPEX gate run | 2,054 [1,675, 2,471] | −1,750 | 2,510 | 682 |
| N2EX gate run | 2,025 [1,643, 2,447] | −1,728 | 2,511 | 682 |

| Wait                                       | MAE change [90% CI] (paired) | Relative |
| ------------------------------------------ | ---------------------------- | -------- |
| d2_0730 → EPEX gate run                    | −392 [−731, −73]             | −16.0%   |
| d2_2230 → EPEX gate run                    | −65 [−167, 33]               | −3.1%    |
| d2_0930 → N2EX gate run                    | −460 [−791, −147]            | −18.5%   |
| d2_2230 → N2EX gate run                    | −95 [−206, 23]               | −4.5%    |
| N2EX gate run → d1_1130 (after both gates) | −121 [−281, −10]             | −6.0%    |

## Example day: 2026-01-12 (EPEX, 11 Jan 07:30 UTC run)

| Measure                       | MW                  |
| ----------------------------- | ------------------- |
| Peak forecast                 | 20,942 at 01:00 UTC |
| Actual at that hour           | 14,072              |
| Day mean forecast / actual    | 19,320 / 14,452     |
| Day max actual                | 15,356              |
| Day MAE raw / corrected       | 4,868 / 2,461       |
| Firm at r=10% (mean of hours) | 12,515              |

## 2026-01-28: was the bad run detectable before the gate?

| Gate | Run used     | Revision vs previous run | Unchanged                 | Mean forecast                            | Mean actual | MAE   | Next run's revision   | First updated run's revision |
| ---- | ------------ | ------------------------ | ------------------------- | ---------------------------------------- | ----------- | ----- | --------------------- | ---------------------------- |
| epex | 27 Jan 07:30 | 0                        | 5 runs since 26 Jan 18:30 | 11,135 (Jan mean 13,221, ceiling 17,756) | 5,760       | 5,375 | 0 (27 Jan 09:30)      | −2,383 (27 Jan 11:30)        |
| n2ex | 27 Jan 09:30 | 0                        | 6 runs since 26 Jan 18:30 | 11,135 (Jan mean 13,225, ceiling 17,756) | 5,760       | 5,375 | −2,383 (27 Jan 11:30) | −2,383 (27 Jan 11:30)        |

Verdict: the error itself was not visible before the gate. The run used had a normal level (well under the delivered ceiling) and a zero revision, because it was an exact copy of every run since 26 Jan 18:30: the NESO forecast had stopped updating. That symptom was visible before both gates, and a 'forecast not updating' rule (3+ identical runs, signal id `run_jump`) fires on 2026-01-28 only among January EPEX decision runs. The first updated run (27 Jan 11:30, after both gates) revised the day by −2,383 MW; every run between the EPEX decision run and it was still frozen.
