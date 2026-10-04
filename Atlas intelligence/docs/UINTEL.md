# UINTEL+ INVEST score in City Atlas Pro

**"Is this location a good idea?"** answered as one 0–100 score with a grade (A+ 85–100, A 70–84, B 55–69, C 40–54, D 0–39). It uses the five UINTEL+ signals with the deck's weights, built only on real inputs.

## Where it is

- More → **invest score** (Pro)
- **Invest score here** on any place card
- Ask Atlas: "analyse Connaught Place for an office investment", "risk profile for Whitefield", "is Cyber City good for co-working"
- API: `GET /api/invest?lng&lat&purpose=investment|home|office|retail|risk[&name][&price&rent][&permitted_far]`

## The five signals

| Signal (weight) | Built from | If missing |
|---|---|---|
| Yield (30%) | **Your** asking price and monthly rent → gross yield = rent × 12 ÷ price. Scored 0–100 between 1.5% and 5% for homes and investment, 4% and 10% for offices and shops. | "no data": no price or rent source is connected |
| FSI gap (20%) | Built FAR = floor area of mapped buildings within 250 m (footprint × floors) ÷ land, against **your** permitted FAR from the master plan. Floors that are not mapped count as one, so built FAR is a low estimate, and the panel says so. | Without permitted FAR, only the built FAR is shown |
| Distress radar (20%) | Google News headlines in 6 months naming the area with auction, e-auction, SARFAESI, NCLT, insolvency, stalled-project or possession-notice words. More headlines mean more motivated sellers. | "no data" without an area name; zero headlines is shown as zero, with "not proof of none" |
| Supply pipeline (15%) | Construction sites mapped in OpenStreetMap within 1.5 km (`landuse` or `building` = construction). Fewer competing projects score higher. | "no data" if OpenStreetMap does not answer (tried again after 15 minutes) |
| Infrastructure (15%) | The place card's own dimensions: transport, connectivity, walkability, schools, clinics, shops, green, fire and police, mixed by purpose | "no data" if streets are not loaded |

- Below **half the weight** covered there is **no score**. The card says what to add.
- The words are built only from signals that have data.
- It never says buy, sell, strong buy or avoid. It is information, not investment advice.

## Not ported from the UINTEL+ MVP

The MVP (`bsocial-uintel-hostinger`) makes every signal with `seededRandom(hash(address))`. Its outlook labels (Strong Buy … Avoid), liquidity, rental yield, price per sq ft and incident lists are generated the same way, so none of them are used. Its visitor CSV with names, emails and phones at `/api/admin/data` is not part of City Atlas.
