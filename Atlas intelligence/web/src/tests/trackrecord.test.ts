import { describe, expect, it } from 'vitest'
import { fetchTrackRecord } from '../data/adapters/trackRecordAdapter'
import { tr, type StringKey } from '../ui/i18n'

describe('track record', () => {
  it('asks the server for the city', async () => {
    const urls: string[] = []
    const f = (async (u: string) => { urls.push(u); return new Response('{"city":"gurugram"}') }) as unknown as typeof fetch
    await fetchTrackRecord('', 'gurugram', f)
    expect(urls[0]).toBe('/api/trackrecord?city=gurugram')
  })
  it('shows misses as well as hits, in English and Hindi', () => {
    for (const k of ['trk.title', 'trk.gen.band', 'trk.gen.error', 'trk.notbeats', 'trk.notyet', 'trk.link'] as StringKey[]) {
      expect(tr('en', k)).toBeTruthy(); expect(tr('hi', k)).toMatch(/[ऀ-ॿ]/)
    }
    expect(tr('en', 'trk.intro')).toMatch(/misses/)
    expect(tr('en', 'tier.pro')).toMatch(/land & project teams/)
  })
})
