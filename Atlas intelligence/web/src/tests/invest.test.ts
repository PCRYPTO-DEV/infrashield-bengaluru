import { describe, expect, it } from 'vitest'
import { fetchInvest, gradeColor, INVEST_PURPOSES } from '../data/adapters/investAdapter'
import { tr, type StringKey } from '../ui/i18n'
import { hasFeature } from '../app/tiers'

describe('UINTEL+ INVEST (Pro)', () => {
  it('sends price and rent only as a pair, and FAR only when positive', async () => {
    const urls: string[] = []
    const f = (async (u: string) => { urls.push(u); return new Response('{}') }) as unknown as typeof fetch
    await fetchInvest('', { lng: 77.2, lat: 28.6, purpose: 'office', price: 1e7, rent: null }, f)
    await fetchInvest('', { lng: 77.2, lat: 28.6, purpose: 'home', price: 1e7, rent: 35000, permittedFar: 2.5 }, f)
    expect(urls[0]).toContain('purpose=office'); expect(urls[0]).not.toContain('price=')
    expect(urls[1]).toContain('price=10000000'); expect(urls[1]).toContain('rent=35000'); expect(urls[1]).toContain('permitted_far=2.5')
  })
  it('colours grades and greys out no score', () => {
    expect(gradeColor('A+')).toBe('#1E8E3E'); expect(gradeColor('D')).toBe('#D93025'); expect(gradeColor(null)).toBe('#9AA0A6')
  })
  it('has every purpose and signal in English and Hindi, and says it is not advice', () => {
    const keys = [...INVEST_PURPOSES.map((p) => `inv.p.${p}`), 'inv.s.yield', 'inv.s.fsiGap', 'inv.s.distress', 'inv.s.supply', 'inv.s.infrastructure', 'inv.notadvice'] as StringKey[]
    for (const k of keys) { expect(tr('en', k)).toBeTruthy(); expect(tr('hi', k)).toMatch(/[ऀ-ॿ]/) }
    expect(tr('en', 'inv.notadvice')).toMatch(/not investment advice/)
  })
  it('is a Pro feature', () => { expect(hasFeature('plus', 'pro.invest')).toBe(false); expect(hasFeature('pro', 'pro.invest')).toBe(true) })
})
