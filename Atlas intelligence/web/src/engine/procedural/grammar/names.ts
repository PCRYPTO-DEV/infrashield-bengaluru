import { PRNG } from '../../seed/prng'

const DISTRICTS = [
  'Indira', 'Kora', 'Jaya', 'Malles', 'Basava', 'Raja', 'Shanti', 'Vijaya', 'Sadashiva', 'Hebbal',
  'Yelahanka', 'Banashankari', 'Vidya', 'Gandhi', 'Nagar', 'Halli', 'Pura', 'Pete', 'Sandra', 'Kere',
]
const SUFFIX = ['nagar', 'halli', 'pura', 'pete', 'layout', 'sandra', 'gudi', 'kere']

export function districtName(rng: PRNG): string {
  const a = rng.choice(DISTRICTS)
  const b = rng.choice(SUFFIX)
  return `${a}${b.charAt(0) === a.charAt(a.length - 1) ? b.slice(1) : b}`.replace(/^./, (c) => c.toUpperCase())
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

const ARTERIAL_NAMES = ['Ring Road', 'Outer Road', 'Trunk Road', 'Main Road', 'Grand Road', 'Bypass', 'Highway']

export function arterialName(rng: PRNG): string {
  return `${rng.choice(DISTRICTS)} ${rng.choice(ARTERIAL_NAMES)}`
}
