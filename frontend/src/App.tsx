import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { FacilityRiskCard } from './components/FacilityRiskCard'
import { TopRiskTable } from './components/TopRiskTable'
import { UploadPanel } from './components/UploadPanel'
import { ReportPanel } from './components/ReportPanel'
import { PipelinePanel } from './components/PipelinePanel'
import { SimulationBar } from './components/SimulationBar'
import { PowerActionsPanel } from './components/PowerActionsPanel'
import { SAMPLE_FACILITIES, SAMPLE_POWER_ASSETS } from './data/sampleFacilities'
import { SCENARIOS, applyScenario, type Scenario } from './data/scenarios'
import { CORRIDORS, DEFAULT_CORRIDOR_STATUSES } from './data/corridors'
import type { Facility, FilterState, LayerState, PowerAsset, PowerScoreDelta, PowerActionPlan } from './types'

const POWER_API = 'http://localhost:8003'
const POWER_POLL_MS = 10 * 60 * 1000  // 10 minutes

const DEFAULT_FILTERS: FilterState = {
  facilityTypes: [],
  riskLevels: [],
  zone: '',
  minConfidence: 0,
}

const DEFAULT_LAYERS: LayerState = {
  facilities: true,
  powerAssets: false,
  floodZones: false,
  waterStress: false,
  roadAccess: false,
  heatZones: false,
  satelliteThermal: false,
  satelliteFlood: false,
  nightLights: false,
  ghostCorridors: false,
  powerStress: false,
}

function applyPowerDeltas(facilities: Facility[], deltas: PowerScoreDelta[]): Facility[] {
  if (!deltas.length) return facilities
  const deltaMap = new Map(deltas.map(d => [d.facility_id, d]))
  return facilities.map(f => {
    const d = deltaMap.get(f.id)
    if (!d) return f
    return {
      ...f,
      power_dependency_score: d.new_power_score,
      continuity_risk_score: d.new_continuity_risk_score,
    }
  })
}

export default function App() {
  const [baseFacilities, setBaseFacilities] = useState<Facility[]>(SAMPLE_FACILITIES)
  const [powerAssets, setPowerAssets] = useState<PowerAsset[]>(SAMPLE_POWER_ASSETS)
  const [riskZones, setRiskZones] = useState<any | null>(null)
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null)
  const [activePanel, setActivePanel] = useState<string>('map')
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null)
  const [corridorStatuses, setCorridorStatuses] = useState(DEFAULT_CORRIDOR_STATUSES)

  // Power Intelligence Layer state
  const [powerDeltas, setPowerDeltas] = useState<PowerScoreDelta[]>([])
  const [powerActionPlans, setPowerActionPlans] = useState<PowerActionPlan[]>([])
  const [powerStressGeoJSON, setPowerStressGeoJSON] = useState<any | null>(null)
  const powerPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Power Intelligence polling — fetch zone stress + score deltas every 10 min
  const fetchPowerData = useCallback(async () => {
    try {
      const [stressRes, deltasRes, actionsRes] = await Promise.all([
        fetch(`${POWER_API}/power/zone-stress`),
        fetch(`${POWER_API}/power/score-deltas`),
        fetch(`${POWER_API}/power/actions`),
      ])
      if (stressRes.ok) setPowerStressGeoJSON(await stressRes.json())
      if (deltasRes.ok) { const d = await deltasRes.json(); setPowerDeltas(d.deltas ?? []) }
      if (actionsRes.ok) { const a = await actionsRes.json(); setPowerActionPlans(a.action_plans ?? []) }
    } catch { /* backend not yet available */ }
  }, [])

  useEffect(() => {
    fetchPowerData()
    powerPollRef.current = setInterval(fetchPowerData, POWER_POLL_MS)
    return () => { if (powerPollRef.current) clearInterval(powerPollRef.current) }
  }, [fetchPowerData])

  // Apply power deltas (layer 1) then scenario overrides (layer 2)
  const facilities = useMemo(() => {
    const withPower = applyPowerDeltas(baseFacilities, powerDeltas)
    return activeScenario ? applyScenario(withPower, activeScenario) : withPower
  }, [baseFacilities, powerDeltas, activeScenario])

  const handleActivateScenario = useCallback((s: Scenario) => {
    setActiveScenario(s)
    setCorridorStatuses({ ...DEFAULT_CORRIDOR_STATUSES, ...s.corridor_statuses })
    // Auto-enable ghost corridors when scenario is activated
    setLayers(prev => ({ ...prev, ghostCorridors: true }))
  }, [])

  const handleResetScenario = useCallback(() => {
    setActiveScenario(null)
    setCorridorStatuses(DEFAULT_CORRIDOR_STATUSES)
  }, [])

  // Poll backend until it comes up — auto-switches from demo to live data
  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof setInterval>

    const tryLoad = async () => {
      try {
        const [facilitiesRes, zonesRes, powerRes] = await Promise.all([
          fetch('/api/facilities'),
          fetch('/api/zones'),
          fetch('/api/power-assets'),
        ])
        if (!facilitiesRes.ok) throw new Error('not ready')
        const [fs, zones, pa] = await Promise.all([
          facilitiesRes.json(),
          zonesRes.json(),
          powerRes.json(),
        ])
        if (!cancelled) {
          setBaseFacilities(fs)
          setRiskZones(zones)
          setPowerAssets(pa)
          setBackendAvailable(true)
          clearInterval(interval)   // stop polling once live
        }
      } catch {
        // keep polling
      }
    }

    tryLoad()
    interval = setInterval(tryLoad, 5000)   // retry every 5s until backend answers

    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const filteredFacilities = useMemo(() => {
    return facilities.filter((f) => {
      if (filters.facilityTypes.length > 0 && !filters.facilityTypes.includes(f.facility_type)) return false
      if (filters.riskLevels.length > 0 && !filters.riskLevels.includes(f.risk_level)) return false
      if (filters.zone && f.zone !== filters.zone) return false
      if (f.data_confidence_score < filters.minConfidence) return false
      return true
    })
  }, [facilities, filters])

  const handleSelectFacility = useCallback((f: Facility) => {
    setSelectedFacility(f)
    setActivePanel('map')
  }, [])

  const handleFacilitiesAdded = useCallback((newFacilities: Facility[]) => {
    setBaseFacilities((prev) => {
      const ids = new Set(newFacilities.map((f) => f.id))
      return [...prev.filter((f) => !ids.has(f.id)), ...newFacilities]
    })
  }, [])

  const handlePanelChange = useCallback((panel: string) => {
    setActivePanel(panel as typeof activePanel)
    if (panel !== 'map') setSelectedFacility(null)
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans">
      <Sidebar
        facilities={filteredFacilities}
        filters={filters}
        layers={layers}
        activePanel={activePanel}
        onFiltersChange={setFilters}
        onLayersChange={setLayers}
        onPanelChange={handlePanelChange}
      />

      <div className="flex flex-1 h-full overflow-hidden relative">
        <MapView
          facilities={filteredFacilities}
          powerAssets={powerAssets}
          riskZones={riskZones}
          layers={layers}
          selectedFacility={selectedFacility}
          onSelectFacility={handleSelectFacility}
          corridors={CORRIDORS}
          corridorStatuses={corridorStatuses}
          activeScenario={activeScenario}
          powerStressGeoJSON={powerStressGeoJSON}
        />

        {/* Right panels */}
        {selectedFacility && activePanel === 'map' && (
          <FacilityRiskCard
            facility={facilities.find(f => f.id === selectedFacility.id) ?? selectedFacility}
            onClose={() => setSelectedFacility(null)}
            activeScenario={activeScenario}
            powerDelta={powerDeltas.find(d => d.facility_id === selectedFacility.id) ?? null}
            powerAction={powerActionPlans.find(p => p.facility_id === selectedFacility.id) ?? null}
          />
        )}

        {/* Power Intelligence panel */}
        {activePanel === 'power' && (
          <div className="w-[340px] flex-shrink-0 h-full flex flex-col bg-slate-900 border-l border-slate-800 overflow-hidden">
            <div className="bg-slate-950 px-4 py-3 flex items-center justify-between border-b border-slate-800">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                ⚡ Power Intelligence Layer
              </div>
              <button onClick={() => setActivePanel('map')} className="text-slate-400 hover:text-white text-xs">✕</button>
            </div>
            <PowerActionsPanel visible={activePanel === 'power'} />
          </div>
        )}

        {activePanel === 'upload' && (
          <UploadPanel
            onFacilitiesAdded={handleFacilitiesAdded}
            onClose={() => setActivePanel('map')}
          />
        )}

        {activePanel === 'report' && (
          <ReportPanel
            facilities={facilities}
            onClose={() => setActivePanel('map')}
          />
        )}

        {activePanel === 'pipeline' && (
          <PipelinePanel
            onFacilityAdded={(f) => handleFacilitiesAdded([f])}
            onClose={() => setActivePanel('map')}
          />
        )}

        {/* Top Risk overlay */}
        {activePanel === 'topRisk' && (
          <TopRiskTable
            facilities={filteredFacilities}
            onSelectFacility={handleSelectFacility}
            onClose={() => setActivePanel('map')}
          />
        )}

        {/* Simulation bar */}
        <SimulationBar
          activeScenario={activeScenario}
          onActivate={handleActivateScenario}
          onReset={handleResetScenario}
        />

        {/* Active scenario banner */}
        {activeScenario && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-4 py-1.5 rounded-full shadow-lg text-white text-[11px] font-bold"
            style={{ background: activeScenario.color, boxShadow: `0 0 20px ${activeScenario.color}66` }}
          >
            <span className="animate-pulse">{activeScenario.emoji}</span>
            SIMULATION: {activeScenario.name.toUpperCase()}
            <span className="font-normal opacity-80">— Synthetic data</span>
          </div>
        )}

        {/* Backend status indicator */}
        {!backendAvailable && !activeScenario && (
          <div className="absolute top-3 right-3 z-[1000] bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-semibold px-3 py-1.5 rounded-full shadow-sm">
            Demo mode — start backend for live data
          </div>
        )}
      </div>
    </div>
  )
}
