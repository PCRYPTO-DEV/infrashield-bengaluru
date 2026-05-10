import { useState, useRef, useCallback } from 'react'
import { X, Zap, Loader2, CheckCircle2, AlertTriangle, RefreshCw, MapPin, ChevronDown, ChevronUp } from 'lucide-react'
import type { Facility } from '../types'
import { ZONES, ALL_FACILITY_TYPES } from '../types'
import { formatFacilityType, RISK_BG_CLASSES } from '../utils/colors'
import { calculateContinuityRisk, classifyRiskLevel } from '../utils/scoring'

interface Props {
  onFacilityAdded: (f: Facility) => void
  onClose: () => void
}

// ── Pipeline event types from backend ────────────────────────────────────────
interface StepStartEvent  { type: 'step_start';  step: string; message: string }
interface StepDoneEvent   { type: 'step_done';   step: string; data: Record<string, any> }
interface StepWarnEvent   { type: 'step_warning';step: string; message: string }
interface CompleteEvent   { type: 'pipeline_complete'; facility: any; confidence: number }
interface SavedEvent      { type: 'facility_saved'; facility: any }
interface ErrorEvent      { type: 'pipeline_error'; message: string }
type PipelineEvent = StepStartEvent | StepDoneEvent | StepWarnEvent | CompleteEvent | SavedEvent | ErrorEvent

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 'bescom',         label: 'BESCOM + Grid Topology',          icon: '⚡',  color: 'text-yellow-600' },
  { id: 'bwssb',         label: 'BWSSB Water + Climate',           icon: '💧',  color: 'text-blue-600'   },
  { id: 'gdelt',         label: 'Flood History (GDELT)',            icon: '🌊',  color: 'text-indigo-600' },
  { id: 'road',          label: 'Road Network (OSM lanes)',         icon: '🛣️',  color: 'text-orange-600' },
  { id: 'road_condition',label: 'Live Conditions (GloFAS + Rain)',  icon: '🌧️',  color: 'text-blue-700'   },
  { id: 'firms',         label: 'Thermal (NASA VIIRS)',             icon: '🌡️',  color: 'text-red-600'    },
]

type StepStatus = 'pending' | 'running' | 'done' | 'warning'

// ── Editable score card ───────────────────────────────────────────────────────
function ScoreCard({
  label, value, source, confidence, onChange,
}: {
  label: string; value: number; source: string; confidence: string; onChange: (v: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const color = value >= 76 ? '#ef4444' : value >= 56 ? '#f97316' : value >= 31 ? '#f59e0b' : '#22c55e'

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-700">{label}</div>
          <div className="text-[10px] text-gray-400 truncate">{source}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="text-sm font-bold"
            style={{ color }}
          >{Math.round(value)}</div>
          <div className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
            confidence === 'high' ? 'bg-green-100 text-green-700' :
            confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {confidence}
          </div>
          {expanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 bg-slate-50 border-t border-gray-100">
          <div className="flex items-center gap-3 mt-2">
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round(value)}
              onChange={e => onChange(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <input
              type="number" min={0} max={100}
              value={Math.round(value)}
              onChange={e => onChange(Number(e.target.value))}
              className="w-14 text-xs border border-gray-200 rounded px-2 py-1 text-center font-bold"
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            Override the auto-detected value. Changes update the CRS preview in real time.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function PipelinePanel({ onFacilityAdded, onClose }: Props) {
  // Form state
  const [name, setName]               = useState('')
  const [lat, setLat]                 = useState('')
  const [lng, setLng]                 = useState('')
  const [zone, setZone]               = useState('')
  const [facilityType, setType]       = useState('hospital')

  // Pipeline state
  const [running, setRunning]         = useState(false)
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({})
  const [stepMessages, setStepMessages] = useState<Record<string, string>>({})
  const [stepData, setStepData]       = useState<Record<string, Record<string, any>>>({})
  const [warnings, setWarnings]       = useState<string[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [done, setDone]               = useState(false)

  // Editable scores (populated after pipeline_complete)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [savedFacility, setSavedFacility] = useState<Facility | null>(null)

  const wsRef = useRef<WebSocket | null>(null)

  // Live CRS preview from current score overrides
  const liveCRS = Object.keys(scores).length >= 6
    ? calculateContinuityRisk({
        criticality_score:       scores.criticality_score ?? 70,
        power_dependency_score:  scores.power_dependency_score ?? 65,
        backup_readiness_score:  scores.backup_readiness_score ?? 40,
        flood_exposure_score:    scores.flood_exposure_score ?? 30,
        water_dependency_score:  scores.water_dependency_score ?? 50,
        road_access_score:       scores.road_access_score ?? 50,
        heat_exposure_score:     scores.heat_exposure_score ?? 35,
        data_confidence_score:   scores.data_confidence_score ?? 60,
      })
    : null

  const liveRiskLevel = liveCRS !== null
    ? classifyRiskLevel(liveCRS, scores.data_confidence_score ?? 60)
    : null

  const runPipeline = useCallback(() => {
    if (!name || !lat || !lng || !zone) return
    setRunning(true); setDone(false); setError(null)
    setWarnings([]); setStepStatuses({}); setStepData({}); setScores({})
    setSavedFacility(null)

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProto}//${window.location.host}/pipeline/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        name, latitude: parseFloat(lat), longitude: parseFloat(lng),
        zone, facility_type: facilityType,
      }))
    }

    ws.onmessage = (ev) => {
      const event: PipelineEvent = JSON.parse(ev.data)

      if (event.type === 'step_start') {
        setStepStatuses(s => ({ ...s, [event.step]: 'running' }))
        setStepMessages(m => ({ ...m, [event.step]: event.message }))
      }

      if (event.type === 'step_done') {
        setStepStatuses(s => ({ ...s, [event.step]: 'done' }))
        setStepData(d => ({ ...d, [event.step]: event.data }))
        // Populate editable scores from step data
        setScores(prev => {
          const next = { ...prev }
          const d = event.data
          if (event.step === 'bescom') {
            next.power_dependency_score = d.power_dependency_score ?? prev.power_dependency_score
          }
          if (event.step === 'bwssb') {
            next.water_dependency_score = d.water_dependency_score ?? prev.water_dependency_score
            next.heat_exposure_score    = d.heat_exposure_score    ?? prev.heat_exposure_score
          }
          if (event.step === 'gdelt') {
            next.flood_exposure_score = d.flood_exposure_score ?? prev.flood_exposure_score
          }
          if (event.step === 'road') {
            next.road_access_score = d.road_access_score ?? prev.road_access_score
          }
          return next
        })
      }

      if (event.type === 'step_warning') {
        setStepStatuses(s => ({ ...s, [event.step]: 'warning' }))
        setWarnings(w => [...w, event.message])
      }

      if (event.type === 'pipeline_complete') {
        const f = event.facility
        setScores(prev => ({
          criticality_score:      f.criticality_score,
          power_dependency_score: f.power_dependency_score,
          backup_readiness_score: f.backup_readiness_score,
          flood_exposure_score:   f.flood_exposure_score,
          water_dependency_score: f.water_dependency_score,
          road_access_score:      f.road_access_score,
          heat_exposure_score:    f.heat_exposure_score,
          data_confidence_score:  f.data_confidence_score,
          ...prev,  // keep any user overrides already made
        }))
      }

      if (event.type === 'facility_saved') {
        setSavedFacility(event.facility as Facility)
        setDone(true)
        setRunning(false)
      }

      if (event.type === 'pipeline_error') {
        setError(event.message)
        setRunning(false)
      }
    }

    ws.onerror = () => {
      setError('WebSocket connection failed — backend may not be running. Check the backend terminal.')
      setRunning(false)
    }

    ws.onclose = () => { wsRef.current = null }
  }, [name, lat, lng, zone, facilityType])

  const confirmAndAdd = () => {
    if (!savedFacility) return
    // Apply any user score overrides to the saved facility
    const updated = {
      ...savedFacility,
      ...scores,
      continuity_risk_score: liveCRS ?? savedFacility.continuity_risk_score,
      risk_level: liveRiskLevel ?? savedFacility.risk_level,
    } as Facility
    onFacilityAdded(updated)
    onClose()
  }

  return (
    <div className="w-[420px] flex-shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" /> Auto-fill from Polymath
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Live data from OSM · GDELT · Open-Meteo</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Input form */}
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Campus / Facility Name</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Manyata Tech Park"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Latitude</label>
              <input
                value={lat} onChange={e => setLat(e.target.value)}
                placeholder="13.0453"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Longitude</label>
              <input
                value={lng} onChange={e => setLng(e.target.value)}
                placeholder="77.6182"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Zone</label>
              <select
                value={zone} onChange={e => setZone(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
              >
                <option value="">Select zone</option>
                {ZONES.filter(z => z !== 'All Zones').map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Facility Type</label>
              <select
                value={facilityType} onChange={e => setType(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
              >
                {ALL_FACILITY_TYPES.map(t => <option key={t} value={t}>{formatFacilityType(t)}</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={runPipeline}
            disabled={running || !name || !lat || !lng || !zone}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg py-2.5 transition-colors"
          >
            {running
              ? <><Loader2 size={14} className="animate-spin" /> Running Polymath Pipeline...</>
              : <><Zap size={14} /> Run Polymath Pipeline</>
            }
          </button>
        </div>

        {/* Live step progress */}
        {(running || done || error) && (
          <div className="p-4 border-b border-gray-100">
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-3">Pipeline Progress</div>
            <div className="space-y-2">
              {STEPS.map(step => {
                const status = stepStatuses[step.id]
                const data   = stepData[step.id]
                const msg    = stepMessages[step.id]
                return (
                  <div key={step.id} className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${
                    status === 'running' ? 'bg-blue-50 border border-blue-100' :
                    status === 'done'    ? 'bg-green-50 border border-green-100' :
                    status === 'warning' ? 'bg-amber-50 border border-amber-100' :
                    'bg-gray-50'
                  }`}>
                    <span className="text-base flex-shrink-0">{step.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${step.color}`}>{step.label}</span>
                        {status === 'running' && <Loader2 size={11} className="animate-spin text-blue-400" />}
                        {status === 'done'    && <CheckCircle2 size={11} className="text-green-500" />}
                        {status === 'warning' && <AlertTriangle size={11} className="text-amber-500" />}
                      </div>
                      {msg && <p className="text-[10px] text-gray-500 mt-0.5">{msg}</p>}

                      {/* Show key findings inline */}
                      {status === 'done' && data && (
                        <div className="mt-1.5 space-y-0.5">
                          {step.id === 'bescom' && <>
                            {data.nearest_substation && (
                              <p className="text-[10px] text-slate-600">
                                📍 Nearest: <strong>{data.nearest_substation}</strong> ({data.nearest_distance_km}km)
                              </p>
                            )}
                            <p className="text-[10px] text-slate-600">
                              Substations within 5km: <strong>{data.substations_within_5km}</strong>
                              {data.single_feeder_risk && <span className="ml-1 text-red-500 font-bold">⚠ Single feeder</span>}
                            </p>
                            <p className="text-[10px] text-slate-600">
                              GDELT outage articles (12m): <strong>{data.outage_articles_12m}</strong>
                            </p>
                            {data.recent_headlines?.slice(0,2).map((h: string, i: number) => (
                              <p key={i} className="text-[9px] text-gray-400 italic truncate">"{h}"</p>
                            ))}
                          </>}
                          {step.id === 'bwssb' && <>
                            {data.nearest_asset && (
                              <p className="text-[10px] text-slate-600">
                                💧 Nearest BWSSB: <strong>{data.nearest_asset}</strong> ({data.nearest_distance_km}km)
                              </p>
                            )}
                            {data.tanker_risk && <p className="text-[10px] text-red-600 font-bold">⚠ No BWSSB asset found — tanker risk</p>}
                            <p className="text-[10px] text-slate-600">
                              Avg max temp (90d): <strong>{data.avg_max_temp_c}°C</strong> · {data.heat_days_above_35} days &gt;35°C
                            </p>
                          </>}
                          {step.id === 'gdelt' && (
                            <p className="text-[10px] text-slate-600">
                              Flood articles (3yr): <strong>{data.flood_articles_3yr}</strong>
                            </p>
                          )}
                          {step.id === 'bescom' && data.power_lines_within_3km !== undefined && (
                            <p className="text-[10px] text-slate-600">
                              OSM power lines (3km): <strong>{data.power_lines_within_3km}</strong>
                              {data.distinct_voltages?.length > 0 && (
                                <span className="ml-1 text-blue-500">· {data.distinct_voltages.join(', ')}V</span>
                              )}
                              {data.grid_redundancy_score !== undefined && (
                                <span className={`ml-1 font-bold ${data.grid_redundancy_score < 0.4 ? 'text-red-500' : 'text-green-600'}`}>
                                  · grid {Math.round(data.grid_redundancy_score * 100)}%
                                </span>
                              )}
                            </p>
                          )}
                          {step.id === 'road' && data.segments_1500m !== undefined && <>
                            <p className="text-[10px] text-slate-600">
                              Roads within 1.5km: <strong>{data.segments_1500m}</strong> segments
                              · {data.approach_count} approach {data.approach_count === 1 ? 'direction' : 'directions'}
                              {data.single_access_risk && <span className="ml-1 text-red-500 font-bold">⚠ Single access</span>}
                            </p>
                            {data.named_roads?.length > 0 && (
                              <p className="text-[10px] text-gray-400 truncate">
                                {data.named_roads.slice(0, 3).join(' · ')}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-600">
                              Road types: <span className="font-medium">{data.road_types?.join(', ') || '—'}</span>
                              {data.avg_lanes > 0 && ` · avg ${data.avg_lanes} lanes`}
                            </p>
                          </>}
                          {step.id === 'road_condition' && data && <>
                            <p className="text-[10px] font-bold" style={{
                              color: data.condition_label === 'Severe' ? '#ef4444' :
                                     data.condition_label === 'Compromised' ? '#f97316' :
                                     data.condition_label === 'Degraded' ? '#f59e0b' : '#22c55e'
                            }}>
                              Roads: {data.condition_label} (score {data.condition_score})
                            </p>
                            <p className="text-[10px] text-slate-600">
                              {data.weather_desc} · {data.precipitation_24h_mm}mm/24h
                              {data.temperature_c != null && ` · ${data.temperature_c}°C`}
                            </p>
                            {data.flood_signal !== 'none' && (
                              <p className="text-[10px] text-blue-700 font-semibold">
                                🌊 GloFAS flood signal: {data.flood_signal}
                                {data.river_discharge_today_m3s != null && ` · ${data.river_discharge_today_m3s} m³/s`}
                                {data.discharge_anomaly_pct != null && ` (${data.discharge_anomaly_pct > 0 ? '+' : ''}${data.discharge_anomaly_pct}% vs baseline)`}
                              </p>
                            )}
                            {data.road_disruption_articles_30d > 0 && (
                              <p className="text-[10px] text-orange-600">
                                ⚠ {data.road_disruption_articles_30d} road disruption reports (30d)
                              </p>
                            )}
                          </>}
                          {step.id === 'firms' && <>
                            <p className="text-[10px] text-slate-600">
                              VIIRS thermal detections (7d): <strong>{data.detections_7d}</strong>
                              {data.chronic_heat_zone && <span className="ml-1 text-orange-500 font-bold">⚠ Chronic heat zone</span>}
                            </p>
                            {data.detections_within_1km > 0 && (
                              <p className="text-[10px] text-red-600">
                                {data.detections_within_1km} detection{data.detections_within_1km > 1 ? 's' : ''} within 1km of facility
                              </p>
                            )}
                            {data.avg_brightness_k && (
                              <p className="text-[10px] text-slate-600">
                                Mean brightness: <strong>{data.avg_brightness_k}K</strong>
                                {data.max_brightness_k && ` · peak ${data.max_brightness_k}K`}
                              </p>
                            )}
                          </>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700">
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        )}

        {/* Interactive score review */}
        {Object.keys(scores).length > 0 && (
          <div className="p-4 border-b border-gray-100">
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">
              Review & Override Scores
            </div>
            <p className="text-[10px] text-gray-400 mb-3">
              Click any score to expand and adjust. Changes update the CRS preview instantly.
            </p>

            <div className="space-y-1.5">
              {[
                { key: 'power_dependency_score',  label: 'Power Dependency',  source: 'OSM substations + power lines + GDELT', conf: 'high'   },
                { key: 'backup_readiness_score',  label: 'Backup Readiness',  source: 'FM questionnaire needed',               conf: 'low'    },
                { key: 'flood_exposure_score',    label: 'Flood Exposure',    source: 'GDELT 3yr history',                     conf: 'medium' },
                { key: 'water_dependency_score',  label: 'Water Dependency',  source: 'OSM BWSSB assets + GDELT',             conf: 'high'   },
                { key: 'road_access_score',       label: 'Road Access',       source: 'OSM road network — live lane data',     conf: 'high'   },
                { key: 'heat_exposure_score',     label: 'Heat Exposure',     source: 'NASA FIRMS VIIRS + Open-Meteo',         conf: 'high'   },
                { key: 'data_confidence_score',   label: 'Data Confidence',   source: 'Auto-computed across all adapters',     conf: 'medium' },
              ].map(({ key, label, source, conf }) => (
                <ScoreCard
                  key={key}
                  label={label}
                  value={scores[key] ?? 50}
                  source={source}
                  confidence={conf}
                  onChange={v => setScores(s => ({ ...s, [key]: v }))}
                />
              ))}
            </div>
          </div>
        )}

        {/* Live CRS preview */}
        {liveCRS !== null && liveRiskLevel && (
          <div className="p-4 border-b border-gray-100">
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Live CRS Preview</div>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-black text-slate-800">{liveCRS}</div>
              <div>
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold border ${RISK_BG_CLASSES[liveRiskLevel]}`}>
                  {liveRiskLevel}
                </span>
                <p className="text-[10px] text-gray-400 mt-1">Updates as you adjust scores above</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100 space-y-2">
        {done && savedFacility && (
          <button
            onClick={confirmAndAdd}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg py-3 transition-colors"
          >
            <MapPin size={14} /> Confirm & Add to Map
          </button>
        )}
        <div className="text-[9px] text-gray-400 text-center leading-tight">
          Scores from OSM · GDELT · Open-Meteo. Low-confidence dimensions require FM questionnaire.
          Not for operational use without field validation.
        </div>
      </div>
    </div>
  )
}
