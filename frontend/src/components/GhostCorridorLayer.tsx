// Animated ghost corridor layer for Leaflet.
// Draws flowing ambulance route lines between hospital pairs.
// Uses CSS stroke-dashoffset animation on SVG path elements.
import { useEffect, useRef } from 'react'
import { Polyline, Tooltip, CircleMarker } from 'react-leaflet'
import type { LatLngTuple } from 'leaflet'
import type { Corridor } from '../data/corridors'
import type { Facility } from '../types'

// ── Global CSS injection (once) ─────────────────────────────────────────────
let _stylesInjected = false
function injectCorridorStyles() {
  if (_stylesInjected || typeof document === 'undefined') return
  _stylesInjected = true
  const el = document.createElement('style')
  el.textContent = `
    @keyframes corridorFlow {
      from { stroke-dashoffset: 60; }
      to   { stroke-dashoffset: 0;  }
    }
    @keyframes corridorFlowFast {
      from { stroke-dashoffset: 30; }
      to   { stroke-dashoffset: 0;  }
    }
    @keyframes hospitalPulse {
      0%   { opacity: 0.6; r: 10; }
      50%  { opacity: 0.2; r: 18; }
      100% { opacity: 0.6; r: 10; }
    }
    .corridor-anim-clear {
      stroke-dasharray: 16 8;
      animation: corridorFlow 1.8s linear infinite;
    }
    .corridor-anim-degraded {
      stroke-dasharray: 10 8;
      animation: corridorFlow 1.1s linear infinite;
    }
    .corridor-anim-blocked {
      stroke-dasharray: 5 6;
      animation: corridorFlowFast 0.65s linear infinite;
    }
    .hospital-pulse-ring {
      animation: hospitalPulse 2.2s ease-in-out infinite;
      pointer-events: none;
    }
  `
  document.head.appendChild(el)
}

// ── Types ────────────────────────────────────────────────────────────────────
type CorridorStatus = 'clear' | 'degraded' | 'blocked'

interface Props {
  corridors: Corridor[]
  facilityMap: Record<string, Facility>
  corridorStatuses: Record<string, CorridorStatus>
  visible: boolean
}

// ── Config per status ─────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<CorridorStatus, {
  color: string
  glowColor: string
  animClass: string
  label: string
  etaMultiplier: number
}> = {
  clear:    { color: '#22c55e', glowColor: 'rgba(34,197,94,0.15)',  animClass: 'corridor-anim-clear',    label: '🟢 OPEN',    etaMultiplier: 1.0 },
  degraded: { color: '#f59e0b', glowColor: 'rgba(245,158,11,0.15)', animClass: 'corridor-anim-degraded', label: '🟡 SLOW',    etaMultiplier: 2.5 },
  blocked:  { color: '#ef4444', glowColor: 'rgba(239,68,68,0.15)',  animClass: 'corridor-anim-blocked',  label: '🔴 BLOCKED', etaMultiplier: 0   },
}

const ROUTE_TYPE_CONFIG = {
  primary:   { glowWeight: 14, lineWeight: 3 },
  secondary: { glowWeight: 10, lineWeight: 2.5 },
  bypass:    { glowWeight: 8,  lineWeight: 2 },
}

// ── Single corridor line ──────────────────────────────────────────────────────
function CorridorLine({
  corridor, from, to, status,
}: {
  corridor: Corridor
  from: Facility
  to: Facility
  status: CorridorStatus
}) {
  injectCorridorStyles()

  const cfg = STATUS_CONFIG[status]
  const routeCfg = ROUTE_TYPE_CONFIG[corridor.route_type]

  const positions: LatLngTuple[] = [
    [from.latitude, from.longitude],
    ...(corridor.waypoints ?? []),
    [to.latitude, to.longitude],
  ]

  const eta = status === 'blocked'
    ? 'DETOUR REQUIRED'
    : `~${Math.round(corridor.estimated_minutes_clear * cfg.etaMultiplier)} min`

  const tooltipContent = (
    <div style={{ fontSize: 11, minWidth: 200, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
        🚑 Ghost Ambulance Corridor
      </div>
      <div style={{ color: '#374151', marginBottom: 3 }}>
        <strong>{corridor.label}</strong>
      </div>
      <div style={{ color: '#6b7280', marginBottom: 3, fontSize: 10 }}>
        {corridor.route}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
        <span style={{ color: '#6b7280' }}>ETA: <strong>{eta}</strong></span>
      </div>
      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 4, color: '#9ca3af', fontSize: 10 }}>
        {from.name} → {to.name}
        <br />
        <em style={{ color: '#d1d5db' }}>
          {corridor.route_type === 'primary' ? 'Primary emergency route' :
           corridor.route_type === 'secondary' ? 'Secondary fallback route' : 'Bypass route (flood alternate)'}
        </em>
      </div>
    </div>
  )

  return (
    <>
      {/* Glow underlay — thick, low opacity */}
      <Polyline
        positions={positions}
        pathOptions={{
          color: cfg.color,
          weight: routeCfg.glowWeight,
          opacity: 0.12,
          dashArray: undefined,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }}
      />

      {/* Animated corridor line — thin, flowing dashes */}
      <Polyline
        positions={positions}
        pathOptions={{
          color: cfg.color,
          weight: routeCfg.lineWeight,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        eventHandlers={{
          add: (e: any) => {
            const path: SVGPathElement | null = e.target.getElement()
            if (!path) return
            // Remove any old animation class
            path.classList.remove('corridor-anim-clear', 'corridor-anim-degraded', 'corridor-anim-blocked')
            path.classList.add(cfg.animClass)
          },
        }}
      >
        <Tooltip sticky>
          {tooltipContent}
        </Tooltip>
      </Polyline>
    </>
  )
}

// ── Hospital pulse rings ──────────────────────────────────────────────────────
function HospitalPulse({ lat, lng, status }: { lat: number; lng: number; status: 'active' | 'stressed' }) {
  injectCorridorStyles()
  const color = status === 'stressed' ? '#f59e0b' : '#22d3ee'
  return (
    <CircleMarker
      center={[lat, lng]}
      radius={14}
      pathOptions={{ color, fillColor: 'transparent', weight: 1.5, opacity: 0 }}
      eventHandlers={{
        add: (e: any) => {
          const el: SVGCircleElement | null = e.target.getElement()
          if (!el) return
          el.style.stroke = color
          el.style.fill = 'transparent'
          el.style.strokeWidth = '1.5'
          el.style.opacity = '0.5'
          el.classList.add('hospital-pulse-ring')
        },
      }}
      interactive={false}
    />
  )
}

// ── Main layer ────────────────────────────────────────────────────────────────
export function GhostCorridorLayer({ corridors, facilityMap, corridorStatuses, visible }: Props) {
  if (!visible) return null

  // Collect hospital node IDs involved in any corridor
  const hospitalIds = new Set<string>()
  corridors.forEach(c => { hospitalIds.add(c.from_id); hospitalIds.add(c.to_id) })

  // A hospital node is "stressed" if any of its corridors are degraded/blocked
  const nodeStress: Record<string, boolean> = {}
  corridors.forEach(c => {
    const st = corridorStatuses[c.id] ?? 'clear'
    if (st !== 'clear') {
      nodeStress[c.from_id] = true
      nodeStress[c.to_id] = true
    }
  })

  return (
    <>
      {/* Pulse rings around hospital nodes */}
      {Array.from(hospitalIds).map(id => {
        const f = facilityMap[id]
        if (!f) return null
        return (
          <HospitalPulse
            key={`pulse-${id}`}
            lat={f.latitude}
            lng={f.longitude}
            status={nodeStress[id] ? 'stressed' : 'active'}
          />
        )
      })}

      {/* Corridor lines — draw glow first (below), then animated lines */}
      {corridors.map(corridor => {
        const from = facilityMap[corridor.from_id]
        const to = facilityMap[corridor.to_id]
        if (!from || !to) return null
        const status = corridorStatuses[corridor.id] ?? 'clear'
        return (
          <CorridorLine
            key={corridor.id}
            corridor={corridor}
            from={from}
            to={to}
            status={status}
          />
        )
      })}
    </>
  )
}
