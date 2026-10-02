/** A short, soft two-tone bleep for a new insight. Needs one user gesture first (browser rule); silent otherwise. */
let ctx: AudioContext | null = null
export function unlockAudio(): void { try { ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); if (ctx.state === 'suspended') void ctx.resume() } catch { ctx = null } }
export function bleep(severity = 0.5): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); g.connect(ctx.destination)
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(660 + severity * 300, t); o.frequency.setValueAtTime(880 + severity * 300, t + 0.09); o.connect(g); o.start(t); o.stop(t + 0.24)
}
