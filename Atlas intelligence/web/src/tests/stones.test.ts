import { describe, expect, it } from 'vitest'
import { STONES } from '../ui/controls/Stones'
import { tr, type StringKey } from '../ui/i18n'

describe('the five stones', () => {
  it('are LOOK, GO, SAFE, CHANGE, WORTH in traffic-light colours', () => {
    expect(STONES.map((s) => s.kind)).toEqual(['look', 'go', 'safe', 'change', 'worth'])
    expect(new Set(STONES.map((s) => s.color)).size).toBe(5)
  })
  it('each has a one-word label and a question, in English and Hindi', () => {
    for (const s of STONES) for (const k of [`stone.${s.kind}`, `stone.${s.kind}.tip`] as StringKey[]) {
      expect(tr('en', k).length).toBeGreaterThan(1)
      expect(tr('hi', k)).toMatch(/[ऀ-ॿ]/)
      if (!k.endsWith('.tip')) expect(tr('en', k).split(' ').length).toBe(k === 'stone.worth' ? 2 : 1)
    }
    expect(tr('en', 'stone.next')).toBe('What next?')
  })
})
