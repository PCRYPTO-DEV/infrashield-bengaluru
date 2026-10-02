/**
 * Free tells you what is here. Plus tells you what it means for you. Pro tells you
 * what it means for a decision. One city model; the question changes.
 * The Plus gate is a password for now (no accounts yet); Pro is shown locked with its scope.
 */
export type Tier = 'free' | 'plus' | 'pro'
export type Feature =
  | 'ask.basic' | 'place.basic' | 'changes.basic' | 'route.basic' | 'alerts.app'
  | 'ask.unlimited' | 'place.views' | 'place.property' | 'compare' | 'brief' | 'changes.full' | 'alerts.message' | 'route.safer' | 'watchlist'
  | 'pro.market' | 'pro.site' | 'pro.scenario' | 'pro.report' | 'pro.projects'

export const FEATURES: Record<Feature, Tier> = {
  'ask.basic': 'free', 'place.basic': 'free', 'changes.basic': 'free', 'route.basic': 'free', 'alerts.app': 'free',
  'ask.unlimited': 'plus', 'place.views': 'plus', 'place.property': 'plus', 'compare': 'plus', 'brief': 'plus', 'changes.full': 'plus', 'alerts.message': 'plus', 'route.safer': 'plus', 'watchlist': 'plus',
  'pro.market': 'pro', 'pro.site': 'pro', 'pro.scenario': 'pro', 'pro.report': 'pro', 'pro.projects': 'pro',
}
const RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 }
/** The Plus password agreed for this stage; replaced by accounts and billing later. */
const PLUS_PASSWORD = 'atbose'
/** Free: how many What changed? items are shown. */
export const FREE_CHANGES = 3

export function hasFeature(tier: Tier, f: Feature): boolean { return RANK[tier] >= RANK[FEATURES[f]] }
export function tierOf(f: Feature): Tier { return FEATURES[f] }
export function loadTier(): Tier { try { const t = localStorage.getItem('atlas.tier'); return t === 'plus' || t === 'pro' ? t : 'free' } catch { return 'free' } }
export function saveTier(t: Tier): void { try { localStorage.setItem('atlas.tier', t) } catch { /* private mode */ } }
/** Returns the tier unlocked by the password, or null when it is wrong. */
export function unlockWithPassword(password: string): Tier | null { return password.trim() === PLUS_PASSWORD ? 'plus' : null }
