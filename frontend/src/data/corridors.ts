// Ghost Corridors: pre-planned ambulance routes between Bengaluru hospitals.
// "Ghost" = kept clear in emergencies; invisible in normal traffic planning.
// Routes derived from BBMP road network + KSEMS emergency response plans.

export interface Corridor {
  id: string
  from_id: string           // facility id
  to_id: string
  label: string             // short display name
  route: string             // actual road description
  route_type: 'primary' | 'secondary' | 'bypass'
  estimated_minutes_clear: number
  waypoints?: [number, number][]  // intermediate lat/lng for realistic routing
}

export const CORRIDORS: Corridor[] = [
  // ── East Bengaluru cluster ─────────────────────────────────────────
  {
    id: 'C001', from_id: 'F001', to_id: 'F002',
    label: 'Manipal → Sakra World',
    route: 'ITPL Road → Marathahalli Junction',
    route_type: 'primary',
    estimated_minutes_clear: 12,
  },
  {
    id: 'C002', from_id: 'F002', to_id: 'F003',
    label: 'Sakra → Bowring (Airport Rd)',
    route: 'Old Airport Road → Museum Road → Bowring',
    route_type: 'primary',
    estimated_minutes_clear: 22,
    waypoints: [[12.9590, 77.6700]],
  },
  // ── North Bengaluru cluster ────────────────────────────────────────
  {
    id: 'C003', from_id: 'F006', to_id: 'F007',
    label: 'Aster CMI ↔ Baptist Hebbal',
    route: 'HMT Layout internal road (200m shared campus boundary)',
    route_type: 'primary',
    estimated_minutes_clear: 3,
  },
  {
    id: 'C004', from_id: 'F006', to_id: 'F004',
    label: 'Aster CMI → KC General',
    route: 'NH-44 Ballari Road southbound → Sankey Road',
    route_type: 'primary',
    estimated_minutes_clear: 18,
    waypoints: [[13.0180, 77.5820]],
  },
  // ── Central Bengaluru cluster ──────────────────────────────────────
  {
    id: 'C005', from_id: 'F003', to_id: 'F004',
    label: 'Bowring → KC General',
    route: 'Queens Road → Raj Bhavan Road → Malleshwaram',
    route_type: 'primary',
    estimated_minutes_clear: 14,
    waypoints: [[12.9880, 77.5860]],
  },
  {
    id: 'C006', from_id: 'F003', to_id: 'F005',
    label: 'Bowring ↔ Vikram (Millers Rd)',
    route: 'Millers Road direct — 1.8 km',
    route_type: 'primary',
    estimated_minutes_clear: 7,
    waypoints: [[12.9840, 77.5955]],
  },
  {
    id: 'C007', from_id: 'F004', to_id: 'F005',
    label: 'KC General ↔ Vikram',
    route: 'Race Course Road',
    route_type: 'secondary',
    estimated_minutes_clear: 9,
  },
  // ── Cross-city lifelines ────────────────────────────────────────────
  {
    id: 'C008', from_id: 'F008', to_id: 'F003',
    label: 'NIMHANS → Bowring Central',
    route: 'Hosur Road → Residency Road',
    route_type: 'primary',
    estimated_minutes_clear: 18,
    waypoints: [[12.9450, 77.6050], [12.9600, 77.6020]],
  },
  {
    id: 'C009', from_id: 'F007', to_id: 'F003',
    label: 'Baptist Hebbal → Bowring',
    route: 'NH-44 → Palace Road → Museum Road',
    route_type: 'secondary',
    estimated_minutes_clear: 25,
    waypoints: [[12.9900, 77.5940]],
  },
  {
    id: 'C010', from_id: 'F001', to_id: 'F008',
    label: 'Manipal Whitefield → NIMHANS',
    route: 'Outer Ring Road → Hosur Road bypass',
    route_type: 'bypass',
    estimated_minutes_clear: 30,
    waypoints: [[12.9620, 77.7000], [12.9500, 77.6500]],
  },
]

export const DEFAULT_CORRIDOR_STATUSES: Record<string, 'clear' | 'degraded' | 'blocked'> =
  Object.fromEntries(CORRIDORS.map(c => [c.id, 'clear']))
