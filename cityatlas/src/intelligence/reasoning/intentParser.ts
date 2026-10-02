export type Intent =
  | { kind: 'whats_happening' }
  | { kind: 'why_slow' }
  | { kind: 'unusual' }
  | { kind: 'dangerous_intersections' }
  | { kind: 'history'; minutes: number }
  | { kind: 'forecast'; minutes: number }
  | { kind: 'site_selection'; business: string }
  | { kind: 'route' }
  | { kind: 'pulse' }
  | { kind: 'help' }

const num = (s: string, re: RegExp, fallback: number) => { const m = re.exec(s); return m ? parseInt(m[1], 10) : fallback }

/**
 * Rule-based intent parsing. Deliberately transparent: the mapping from
 * words to query is inspectable, and a language model (if one is ever
 * attached) only rewrites the final explanation — it never decides what
 * data to fetch.
 */
export function parseIntent(question: string): Intent {
  const q = question.toLowerCase().trim()
  if (/(caf[eé]|coffee|shop|store|restaurant|open a|business|where should)/.test(q)) {
    const m = /(caf[eé]|coffee|restaurant|shop|store|pharmacy|gym)/.exec(q)
    return { kind: 'site_selection', business: m ? m[1] : 'business' }
  }
  if (/(next|coming|may happen|will happen|forecast|predict|future)/.test(q)) return { kind: 'forecast', minutes: num(q, /(\d+)\s*(min|minute)/, 30) }
  if (/(last|past|previous|earlier|ago|history|happened)/.test(q) && /(hour|min|minute|today)/.test(q)) return { kind: 'history', minutes: /hour/.test(q) ? 60 * num(q, /(\d+)\s*hour/, 1) : num(q, /(\d+)\s*(min|minute)/, 60) }
  if (/(why).*(slow|traffic|jam|congest)|(slow|jam|congest).*(why)/.test(q) || /why is traffic/.test(q)) return { kind: 'why_slow' }
  if (/(unusual|abnormal|anomal|strange|odd|weird)/.test(q)) return { kind: 'unusual' }
  if (/(danger|risk|unsafe|accident|hazard).*(intersection|junction|crossing|road|where)|(intersection|junction).*(danger|risk)/.test(q)) return { kind: 'dangerous_intersections' }
  if (/(safe|safer|best|quick).*(route|way|path)|route/.test(q)) return { kind: 'route' }
  if (/(pulse|overview|status|health|how is the city)/.test(q)) return { kind: 'pulse' }
  if (/(what('| i)?s happening|what is going on|what's going on|activity|here)/.test(q)) return { kind: 'whats_happening' }
  return { kind: 'help' }
}
