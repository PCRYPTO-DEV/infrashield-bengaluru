import { describe, it, expect, vi, afterEach } from 'vitest'
import { ClaudeExplainer } from '../intelligence/reasoning/claudeExplainer'
import type { EvidenceItem } from '../intelligence/reasoning/evidence'

const ev: EvidenceItem[] = [{ id: 'a', classification: 'observed', statement: 'Ring Road is at half speed', source: 'tomtom' }]

afterEach(() => vi.unstubAllGlobals())

describe('AI writer client', () => {
  it('sends only slim evidence and the language, and labels the writer', async () => {
    let sent: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ text: 'हमने देखा: Ring Road आधी रफ़्तार पर है।', writer: 'claude-opus-5-5', language: 'hi' }), { status: 200 }) }))
    const w = new ClaudeExplainer('http://x', () => 'hi')
    const text = await w.explain('ट्रैफ़िक धीमा क्यों है?', 'why_slow', ev)
    expect(text).toContain('Ring Road')
    expect(w.lastWriter).toBe('claude-opus-5-5')
    expect(sent).toMatchObject({ language: 'hi', intent: 'why_slow', evidence: [{ classification: 'observed', statement: 'Ring Road is at half speed', source: 'tomtom' }] })
    expect(JSON.stringify(sent)).not.toContain('location')
  })
  it('falls back to the template writer when the server is missing or declines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'writer not configured: set ANTHROPIC_API_KEY' }), { status: 503 })))
    const w = new ClaudeExplainer('http://x', () => 'en')
    const text = await w.explain('Why is traffic slow?', 'why_slow', ev)
    expect(text).toContain('Ring Road is at half speed')
    expect(w.lastWriter).toBe('template')
    expect(w.lastError).toContain('ANTHROPIC_API_KEY')
    expect(await w.askFree('Is it raining?', ev)).toBeNull()
  })
  it('never calls the server with no evidence', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const w = new ClaudeExplainer('http://x', () => 'en')
    await w.explain('q', 'help', [])
    expect(f).not.toHaveBeenCalled()
  })
})
