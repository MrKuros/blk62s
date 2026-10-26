# GB day-ahead market timing

Researched 2026-10-26 to choose the app's default decision cutoff. All times are UK local (GMT in winter, BST in summer). **In January, UK local = UTC**, so for the Jan-2026 scope you can compare cutoffs directly against WINDFOR `publishTime` (UTC) with no DST handling. Keep a tz-aware conversion anyway (Europe/London) so a summer date range doesn't break silently.

## 1. Nord Pool (N2EX), GB

| Auction              | Product                                   | Gate closure (D-1) | Results                    |
| -------------------- | ----------------------------------------- | ------------------ | -------------------------- |
| N2EX Day-Ahead       | hourly (24 h; 23/25 on clock-change days) | **09:50**          | by **10:00** at the latest |
| GB Half Hour Auction | half-hourly (48 periods)                  | **14:30**          | within 5 min               |

- N2EX DA: "Gate closure time is 09:50 GMT / 10:50 CET and results are published at latest 10:00 GMT / 11:00 CET." https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-n2ex-day-ahead-auction
- The GB product spec says "Gate Closure: 09:50 GMT/BST", so it follows UK local time. Order types: hourly, block, exclusive groups, flexible. https://www.nordpoolgroup.com/49f306/globalassets/download-center/rules-and-regulations/product-specifications-gb-28.06.22.pdf
- GB Half Hour: the support page says "Gate closure is 15:30 CET and results are published within 5 minutes", which is 14:30 UK. https://support.nordpoolgroup.com/support/solutions/articles/8000077433-about-the-gb-half-hour-auction . This matches the product spec, section 4, "Gate Closure: 14:30 GMT/BST" (same PDF as above). Note: this is **not** 15:30, which is the EPEX half-hour auction.

## 2. EPEX SPOT, GB

| Auction                         | Product     | Gate closure (D-1) | Results        |
| ------------------------------- | ----------- | ------------------ | -------------- |
| GB Day-Ahead 60 min             | hourly      | **09:20**          | from **09:30** |
| GB Day-Ahead 30 min (half-hour) | half-hourly | **15:30**          | from **15:45** |
| (context) GB IDA1               | 30 min      | 17:30 D-1          |                |

- Sources: "Closure of orderbook: daily at 12:00 (CET) (9:20 GMT for Great Britain ...)", "Publication of results ... 9:30 GMT for Great Britain"; half-hour GB auction "daily at 15:30 (GMT) in D-1", results "from 15:45 (GMT)". https://www.epexspot.com/en/tradingproducts
- Since Brexit the GB 60-min auction is no longer part of SDAC, and interconnectors run explicit auctions. https://www.epexspot.com/en/focus-gb
- The same 09:20 and 15:30 times appear in the 2022 trading brochure: https://www.epexspot.com/sites/default/files/2022-06/22-06-02_TradingBrochure.pdf

## 3. Which one is "the" GB day-ahead reference in 2026?

- **There is no single official one. The reference is the two hourly auctions together (EPEX 09:20 + N2EX 09:50).** The CfD Intermittent Market Reference Price (IMRP) is computed hourly "using day-ahead data received from EPEX SPOT and N2EX". https://www.lowcarboncontracts.uk/our-schemes/contracts-for-difference/market-reference-prices/ (method since 1 Jan 2021: https://www.lowcarboncontracts.uk/news/how-intermittent-market-reference-price-imrp-will-be-calculated-from-1-january-2021/)
- The hourly DA auctions carry the most liquidity, and volumes are highest in the earliest-closing auctions: "trading volumes are highest in auctions with earlier gate closure times". The half-hourly auctions are for rebalancing. https://modoenergy.com/research/en/wholesale-trading-markets-explainer-gb-n2ex-epex-dayahead-intraday
- EPEX says its 60-min auction is "the most reliable reference price" (https://www.epexspot.com/en/focus-gb). That is the exchange's own marketing, and a 2026 market-share split between EPEX and N2EX was not verified. **UNVERIFIED**.

## 4. Recent changes

- The last structural timing change found is Brexit, effective 1 Jan 2021. N2EX gate closure moved from 11:00 to 09:50 GMT and results from 11:42 to 10:00, and GB was decoupled from SDAC. https://www.nordpoolgroup.com/en/message-center-container/newsroom/exchange-message-list/2020/q4/nord-pool-announces-gb-auction-changes-for-brexit/ . The EPEX brochure notes "the GB 60 min Day-Ahead auction timing has been moved up" for the same reason.
- **2024-2026: no announced change to the GB DA gate-closure times was found.** Current EPEX and Nord Pool pages still show 09:20 / 09:50 / 14:30 / 15:30. **UNVERIFIED** that nothing changed in this window; the full exchange-message archives were not searched. The EU-side 15-min SDAC go-live (2025) does not apply to GB, which is outside SDAC.
- Re-coupling GB with the EU day-ahead market under the TCA had not happened as of these sources. **UNVERIFIED** for late 2026.

## Implication for WINDFOR

Observed WINDFOR runs on 2026-01-10 (UTC): 02:30, 04:30, 07:30, **09:30**, 11:30, 15:30, 18:30, 22:30.

- Cutoff 09:20: the latest usable run is **07:30**.
- Cutoff 09:50: the **09:30** run counts on paper. But a 20-minute gap is not enough to re-bid realistically, and `publishTime` may not equal the moment the data is actually available (**UNVERIFIED** lag).
- Cutoff 14:30: latest run 11:30. Cutoff 15:30: the 15:30 run is excluded if the rule is strict `<` (and included if `<=`). **Use strict `publishTime < cutoff`.**

## Recommendation

**Default cutoff: 09:20 UK local on D-1 (the EPEX GB 60-min gate closure). Use only WINDFOR runs with `publishTime < cutoff`.**

How the app states it:

> The default decision time is 09:20 UK time on the day before delivery, which is gate closure of the EPEX SPOT GB hourly day-ahead auction. It is the earlier of GB's two main hourly day-ahead auctions (N2EX closes at 09:50), and together they set the GB day-ahead reference price. A buyer bidding into both must have their volumes fixed by then, so the replay only uses wind forecasts published before it.

Alternatives considered (the app ships EPEX 09:20 / N2EX 09:50 / a custom time, plus an optional 0/10/20 min data-latency margin):

| Label                       | Time (UK, D-1) | Latest WINDFOR run used (Jan) |
| --------------------------- | -------------- | ----------------------------- |
| EPEX GB DA 60-min (default) | 09:20          | 07:30                         |
| N2EX DA hourly              | 09:50          | 09:30                         |
| Nord Pool GB Half-Hour      | 14:30          | 11:30                         |
| EPEX GB DA 30-min           | 15:30          | 11:30 (strict <)              |
| Optional: "early desk"      | 08:00          | 07:30                         |

The value-of-waiting view then shows how much error falls between the 07:30 and 11:30 runs, which tells a buyer whether waiting for the half-hourly auctions is worth it.
