# Gentrification in City Atlas Pro

City Atlas Pro now answers **"is this area gentrifying?"** for any spot in India. It runs the BSOCIAL engine (ATBOSE's community and gentrification indices) on **real data only**.

## Where it is

| Where | What |
|---|---|
| More → **gentrification** (Pro) | The panel: search a place, use the map centre, or tap the map |
| Place card → **Gentrification here** | Opens the panel for that spot. Free and Plus users see the Pro lock. |
| Panel → **Show on map** | Hex layer coloured by stage: green Stable, amber Transitional, orange Emerging, red High. Hover shows the stage; a click opens that hex. |
| Ask Atlas | "Is Hauz Khas gentrifying?", "who lives in Sector 49", "displacement risk in Whitefield". The answer comes with facts, and the panel opens. |
| API | `GET /api/gentrification?lng&lat[&name][&price_trend]`, `GET /api/gentrification/grid?bbox` |

## Inputs (all real)

| Input | Source | Refresh |
|---|---|---|
| Places within 1 km: cafés, restaurants, gyms, schools, clinics, parks, banks, shops, coworking, premium | OpenStreetMap via Overpass. One fetch per H3 res-7 cell (2.5 km), using BSOCIAL's own query and categories. | cached 7 days |
| The same counts 24, 18, 12 and 6 months ago, for the area and its 5 km ring | Overpass history (`[date:"…"]` + `out count`) | cached 30 days |
| Headlines naming the area in the last 30 days | Google News RSS search | cached 6 h |
| Crimes reported within 1 km in 90 days | City Atlas reports + placed news crimes | live |

## BSOCIAL formulas: kept, replaced, dropped

| BSOCIAL piece | In City Atlas | Why |
|---|---|---|
| CBI = .15 Family + .12 Investor + .15 Lifestyle + .13 Engagement + .15 Stability + .15 Gentrification + .15 Digital Buzz | **Kept**, same weights and same per-component formulas (parity tested) | Built from mapped places |
| Engagement: Reddit mentions + Reddit sentiment | **Replaced**: news mentions; sentiment is left out and the remaining weights renormalised | Reddit blocks server requests; sentiment is not measured |
| Digital Buzz: Nominatim "importance" + Reddit | **Replaced**: news mentions, coworking, premium share. With no headlines it is "no data". | Fame is not buzz |
| Stability | **Kept**, and lowered by reported crime (×(1 − 0.3·crimes/30)); unchanged when none are reported | Real incidents |
| GI = .30 Amenity Premium + .35 Price Momentum + .15 Rental Turnover + .20 Digital Buzz | **Kept** for Amenity Premium and Digital Buzz. **Price Momentum** is used only when the person types a price trend (shown as "your figure"). **Rental Turnover** is "no data". The GI renormalises over the parts it has and shows its coverage (usually 50%). | BSOCIAL computed price and rent from the amenity counts, which is not price or rent data |
| GI stages: <40 Stable, <60 Transitional, <80 Emerging, ≥80 High | **Kept** | |
| Archetypes (6 centroids, softmax T = 0.3) | **Kept**, labelled *inferred*; needs at least 5 measured CBI dimensions | |
| Trend vector and 12-month forecast | **Kept**, but run on the **real** two-year series of premium places, with the 5 km ring's mapping growth taken out | BSOCIAL ran them on `Math.random()` series |
| Government advisory: infrastructure pressure / planning, displacement, spillover, environment | **Kept** with the same thresholds. Spillover uses the 6 real neighbouring H3 cells, weighted by exp(−d/1.5 km). | |
| Advisory: law and order (network cohesion), civic services (households), youth (average age) | **Replaced** by a rule on reported crime (≥10 in 90 days with CBI < 40); the other two are **dropped** | Their inputs were invented |
| Developer grade = .30 liquidity + .25 price + .20 GI + .25 CBI | Shown **only** when a price trend is typed, renormalised over 70% of the weight; otherwise "not graded" | Liquidity has no source |
| Households, average age, median income, days on market, demo societies | **Dropped** | Invented |
| Confidence (a constant in BSOCIAL) | **Replaced**: GI coverage × data freshness | |

The UINTEL+ MVP (`bsocial-uintel-hostinger`) builds every score from `seededRandom(hash(address))`, so none of its numbers are used. Its visitor-data CSV endpoint is not part of City Atlas.

## Honest limits

- OpenStreetMap growth is partly mapping growth. The 5 km ring is the baseline that takes most of it out, and the panel says it is not a price.
- The map layer shows only the amenity-premium part of the index per hex. It has no headlines, price or rent, and the legend says so.
- The first look at an area takes a few seconds while places are counted, and about a minute for the two-year history. The panel says "counting…" and fills in by itself.

## Later

- **UINTEL+ INVEST score** (Yield, FSI Gap, Distress Radar, Supply Pipeline, Infrastructure) on the same rules.
- **Price momentum and rental turnover**, once a real source is connected (RBI/NHB RESIDEX house price indices are city-level; listings need a licensed feed).
- **GCCOS DRISHTI, SAR and AIRAD.** Their own documents say the SAR and base scores are still synthetic. They wait for real adapters.
