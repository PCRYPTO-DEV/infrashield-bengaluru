/**
 * Free tells you what is here. Plus tells you what it means for you. Pro tells you
 * what it means for a decision. One city model; the question changes.
 * The gates are passwords for now (no accounts yet): one opens Plus, the Pro one opens the workstation.
 */
export type Tier = 'free' | 'plus' | 'pro'
export type Feature =
  | 'ask.basic' | 'place.basic' | 'changes.basic' | 'route.basic' | 'alerts.app'
  | 'ask.unlimited' | 'place.views' | 'place.property' | 'compare' | 'brief' | 'changes.full' | 'alerts.message' | 'route.safer' | 'watchlist'
  | 'pro.market' | 'pro.site' | 'pro.scenario' | 'pro.report' | 'pro.projects' | 'pro.gentrification' | 'pro.invest'

export const FEATURES: Record<Feature, Tier> = {
  'ask.basic': 'free', 'place.basic': 'free', 'changes.basic': 'free', 'route.basic': 'free', 'alerts.app': 'free',
  'ask.unlimited': 'plus', 'place.views': 'plus', 'place.property': 'plus', 'compare': 'plus', 'brief': 'plus', 'changes.full': 'plus', 'alerts.message': 'plus', 'route.safer': 'plus', 'watchlist': 'plus',
  'pro.market': 'pro', 'pro.site': 'pro', 'pro.scenario': 'pro', 'pro.report': 'pro', 'pro.projects': 'pro', 'pro.gentrification': 'pro', 'pro.invest': 'pro',
}
const RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 }
/** Free: how many What changed? items are shown. */
export const FREE_CHANGES = 3

export function hasFeature(tier: Tier, f: Feature): boolean { return RANK[tier] >= RANK[FEATURES[f]] }
export function tierOf(f: Feature): Tier { return FEATURES[f] }

// ---- The lock lives on the server: a password is swapped for a signed token (POST /api/unlock),
// and every Pro request carries it. The app only reads the token's tier and expiry to show the
// right buttons; the server checks the signature. No password is in this code.
const TOKEN_KEY = 'atlas.token'
let token: string | null = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* private mode */ }
try { localStorage.removeItem('atlas.tier') } catch { /* old, unsigned tier from before the server lock */ }

/** The tier a token says it carries (not verified here: the server does that), or free when missing or expired. */
export function tierFromToken(t: string | null, now = Date.now()): Tier {
  if (!t || !t.includes('.')) return 'free'
  try {
    const body = t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    const data = JSON.parse(atob(body + '='.repeat((4 - (body.length % 4)) % 4))) as { t?: string; exp?: number }
    return (data.t === 'plus' || data.t === 'pro') && (data.exp ?? 0) * 1000 > now ? data.t : 'free'
  } catch { return 'free' }
}
export function loadTier(): Tier { return tierFromToken(token) }
export function setToken(t: string | null): void { token = t; try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ } }
/** Headers for a request that may need Plus or Pro. */
export function authHeaders(): Record<string, string> { return token ? { 'X-Atlas-Token': token } : {} }
/** fetch that carries the token; a 403 means the token is gone or expired, and the app locks back to free. */
let onForbidden: (() => void) | null = null
export function onTokenRejected(fn: () => void): void { onForbidden = fn }
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() } })
  if (r.status === 403 && token) onForbidden?.()
  return r
}
export type UnlockResult = { tier: Tier } | { error: 'wrong' | 'tries' | 'offline' }
/** Ask the server: the password becomes a token for the tier it opens. */
export async function unlockOnServer(base: string, password: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<UnlockResult> {
  try {
    const r = await fetchImpl(`${base}/api/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
    if (r.status === 429) return { error: 'tries' }
    if (!r.ok) return { error: 'wrong' }
    const d = (await r.json()) as { tier: Tier; token: string }
    setToken(d.token)
    return { tier: d.tier }
  } catch { return { error: 'offline' } }
}
