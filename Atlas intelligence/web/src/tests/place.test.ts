import { describe, it, expect } from 'vitest'
import { orderDimensions, viewScore, strengthsAndWeaknesses, questionsWorthAsking, bestMatch } from '../intelligence/place/relevance'
import { hasFeature, unlockWithPassword, FEATURES } from '../app/tiers'
import type { Dimension, PlaceState } from '../data/adapters/placeAdapter'

const d = (key: string, score: number | null, cls: Dimension['class'] = 'derived'): Dimension => ({ key, score, band: null, class: cls, confidence: score === null ? null : 0.6, confidenceWord: null, why: [`${key} why`], provenance: [], note: score === null ? 'no data' : null })
const dims = [d('traffic', 30, 'observed'), d('air', 60, 'observed'), d('access_school', 90), d('access_health', 70), d('green', 20), d('flood', null, 'inferred'), d('population', null, 'inferred'), d('walkability', 55), d('noise', 40, 'inferred')]

describe('relevance: same facts, different order', () => {
  it('puts the family priorities first, no-data rows last, never changes a score', () => {
    const fam = orderDimensions(dims, 'family')
    expect(fam[0].key).toBe('access_school')
    expect(fam.slice(-2).map((x) => x.key).sort()).toEqual(['flood', 'population'])
    expect(fam.find((x) => x.key === 'traffic')!.score).toBe(30)
    const pro = orderDimensions(dims, 'professional')
    expect(pro[0].key).toBe('traffic')
  })
  it('scores a view only from measured dimensions', () => {
    expect(viewScore([d('flood', null), d('population', null)], 'family')).toBeNull()
    const s = viewScore(dims, 'family')!
    expect(s).toBeGreaterThan(0); expect(s).toBeLessThan(100)
  })
  it('names strengths and weaknesses for the summary', () => {
    const { strong, weak } = strengthsAndWeaknesses(dims, 'everyone')
    expect(strong.map((x) => x.key)).toContain('access_school')
    expect(weak.map((x) => x.key)).toContain('traffic')
  })
  it('turns missing data into questions to ask in person', () => {
    const q = questionsWorthAsking(dims)
    expect(q).toContain('q.flood'); expect(q).toContain('q.peak'); expect(q.length).toBeLessThanOrEqual(4)
  })
  it('compares on the chosen priorities without declaring a universal winner', () => {
    const state = (over: Partial<Record<string, number | null>>): PlaceState => ({ cell: 'x', res: 9, centre: { lng: 0, lat: 0 }, boundary: [], areaKm2: 0.1, score: 50, band: 'moderate', trend: null, trendNote: null, confidence: 0.5, confidenceWord: 'medium', dimensions: dims.map((x) => ({ ...x, score: over[x.key] === undefined ? x.score : over[x.key]! })), structure: { roadsKm: {}, paths: 0, buildings: 0, greenShare: 0, tilesChecked: 0, entities: 0 }, computedAt: 0 })
    const r = bestMatch([{ name: 'A', state: state({ traffic: 90 }) }, { name: 'B', state: state({ access_school: 20 }) }], ['traffic', 'access_school'])
    expect(r[0].score).toBe(90); expect(r[1].score).toBe(25)
    expect(r[0].perPriority.traffic).toBe(90)
  })
})

describe('tiers', () => {
  it('free sees what is here; plus what it means; pro what it means for a decision', () => {
    expect(hasFeature('free', 'place.basic')).toBe(true)
    expect(hasFeature('free', 'compare')).toBe(false)
    expect(hasFeature('plus', 'compare')).toBe(true)
    expect(hasFeature('plus', 'pro.scenario')).toBe(false)
    expect(hasFeature('pro', 'pro.scenario')).toBe(true)
    expect(Object.values(FEATURES).every((t) => ['free', 'plus', 'pro'].includes(t))).toBe(true)
  })
  it('the password unlocks plus and nothing else', () => {
    expect(unlockWithPassword('atbose')).toBe('plus')
    expect(unlockWithPassword(' atbose ')).toBe('plus')
    expect(unlockWithPassword('wrong')).toBeNull()
  })
})
