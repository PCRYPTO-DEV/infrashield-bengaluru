import { describe, expect, it } from 'vitest'
import { coverageLine, fetchGentrification, giColor, GI_COLORS, type GentriReport } from '../data/adapters/gentrificationAdapter'
import { makeT } from '../ui/i18n'
import { tr, type StringKey } from '../ui/i18n'
import { hasFeature } from '../app/tiers'

describe('gentrification (Pro)', () => {
  it('colours stages like traffic and greys out no data', () => {
    expect(giColor('stable')).toBe(GI_COLORS.stable)
    expect(giColor('high')).toBe('#D93025')
    expect(giColor(null)).toBe('#9AA0A6')
  })
  it('says how much of the index is measured and names what is missing', () => {
    const comp = (k: string, v: number | null) => ({ key: k, weight: 0, value: v, class: null, why: '' })
    const half = { gi: { value: 22, class: 'stable', coverage: 0.5, components: [comp('amenityPremium', 0.2), comp('priceMomentum', null), comp('rentalTurnover', null), comp('digitalBuzz', 0.1)] } } as unknown as GentriReport
    expect(coverageLine(half, makeT('en') as never)).toBe('50% of the index measured · no source yet: price momentum, rental turnover')
    const typed = { gi: { ...half.gi, coverage: 0.65, components: [comp('amenityPremium', 0.2), comp('priceMomentum', 0.4), comp('rentalTurnover', null), comp('digitalBuzz', null)] } } as unknown as GentriReport
    expect(coverageLine(typed, makeT('en') as never)).toBe('65% of the index measured · no source yet: rental turnover, digital buzz (headlines)')
    expect(coverageLine(half, makeT('hi') as never)).toMatch(/सूचकांक का 50%/)
  })
  it('has every stage, archetype and advisory in English and Hindi', () => {
    const keys = ['gen.class.stable', 'gen.class.transitional', 'gen.class.emerging', 'gen.class.high', 'gen.arch.family-stability', 'gen.arch.young-professional', 'gen.arch.investor-dominant',
      'gen.arch.transitional-premium', 'gen.arch.quiet-established', 'gen.arch.high-mobility-rental', 'gen.adv.infra_pressure', 'gen.adv.infra_planning', 'gen.adv.displacement', 'gen.adv.environment',
      'gen.adv.law_order', 'gen.adv.spillover', 'gen.trend.accelerating', 'gen.trend.steady-up', 'gen.trend.flat', 'gen.trend.decelerating', 'gen.trend.declining'] as StringKey[]
    for (const k of keys) { expect(tr('en', k)).toBeTruthy(); expect(tr('hi', k)).toMatch(/[ऀ-ॿ]/) }
  })
  it('is a Pro feature', () => {
    expect(hasFeature('plus', 'pro.gentrification')).toBe(false)
    expect(hasFeature('pro', 'pro.gentrification')).toBe(true)
  })
  it('sends the typed price trend only when there is one', async () => {
    const urls: string[] = []
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ status: 'pending', retryInS: 5, name: null, message: '' })) }) as unknown as typeof fetch
    await fetchGentrification('', { lng: 77.2, lat: 28.6, name: 'Hauz Khas' }, f)
    await fetchGentrification('', { lng: 77.2, lat: 28.6, priceTrend: 8 }, f)
    expect(urls[0]).toContain('name=Hauz+Khas'); expect(urls[0]).not.toContain('price_trend')
    expect(urls[1]).toContain('price_trend=8')
  })
})
