import type { Language } from '../intelligence/reasoning/claudeExplainer'

/**
 * Voice in and out through the browser's own Web Speech API. Nothing is
 * installed and no audio leaves the page except through the browser's
 * speech service, which the user's browser controls. Both directions are
 * optional: when the browser lacks them the buttons simply do not appear.
 */
const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' }

interface RecognitionLike extends EventTarget {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean
  start(): void; stop(): void; abort(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  const w = globalThis as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canListen(): boolean { return recognitionCtor() !== null }
export function canSpeak(): boolean { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' }

/** Listen once and resolve with the transcript (empty string on silence or error). */
export function listenOnce(language: Language, onPartial?: (t: string) => void): { done: Promise<string>; cancel(): void } {
  const Ctor = recognitionCtor()
  if (!Ctor) return { done: Promise.resolve(''), cancel() {} }
  const r = new Ctor()
  r.lang = LOCALE[language]; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false
  let final = ''
  const done = new Promise<string>((resolve) => {
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; final = t; onPartial?.(t) }
    r.onerror = () => resolve(final)
    r.onend = () => resolve(final.trim())
    try { r.start() } catch { resolve('') }
  })
  return { done, cancel: () => { try { r.abort() } catch { /* already stopped */ } } }
}

/** Read text aloud in the chosen language; returns false when speech is unavailable. */
export function speak(text: string, language: Language): boolean {
  if (!canSpeak()) return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = LOCALE[language]
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(language === 'hi' ? 'hi' : 'en-in')) ?? speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(language))
  if (voice) u.voice = voice
  u.rate = 0.95
  speechSynthesis.speak(u)
  return true
}

export function stopSpeaking(): void { if (canSpeak()) speechSynthesis.cancel() }
