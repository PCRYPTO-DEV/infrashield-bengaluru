import { useState } from 'react'
import { X, AlertTriangle, CheckCircle2, Info, Zap, Droplets, Waves, Thermometer, Shield, CloudRain, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import type { Facility, PowerScoreDelta, PowerActionPlan } from '../types'
import { RISK_BG_CLASSES, RISK_COLORS, facilityTypeIcon, formatFacilityType, scoreToBarColor } from '../utils/colors'
import { SCORE_BREAKDOWN_LABELS } from '../utils/scoring'
import { useLiveConditions, CONDITION_COLORS, FLOOD_COLORS } from '../hooks/useLiveConditions'
import { generateNarrative } from '../utils/narrative'
import { getFacilityScenarioNote, type Scenario } from '../data/scenarios'

const TIER_COLORS: Record<string, string> = {
  LOW: '#22c55e', ELEVATED: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#7f1d1d'
}

interface Props {
  facility: Facility
  onClose: () => void
  activeScenario?: Scenario | null
  powerDelta?: PowerScoreDelta | null
  powerAction?: PowerActionPlan | null
}

function ScoreBar({ label, value, inverted }: { label: string; value: number; inverted?: boolean }) {
  const displayValue = inverted ? 100 - value : value
  const color = scoreToBarColor(displayValue)
  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold" style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${displayValue}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function CircleScore({ score, riskLevel }: { score: number; riskLevel: string }) {
  const color = RISK_COLORS[riskLevel as keyof typeof RISK_COLORS] ?? '#9ca3af'
  const circumference = 2 * Math.PI * 36
  const progress = ((100 - score) / 100) * circumference
  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle
          cx="40" cy="40" r="36" fill="none"
          stroke={color} strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={progress}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-800">{score}</span>
        <span className="text-[9px] text-gray-500 font-medium">/ 100</span>
      </div>
    </div>
  )
}

export function FacilityRiskCard({ facility: f, onClose, activeScenario, powerDelta, powerAction }: Props) {
  const riskClass = RISK_BG_CLASSES[f.risk_level] ?? 'bg-gray-100 text-gray-700'
  const { data: live, loading: liveLoading } = useLiveConditions(
    f.latitude, f.longitude, f.zone, true
  )
  const [narrativeExpanded, setNarrativeExpanded] = useState(true)
  const narrative = generateNarrative(f)
  const scenarioNote = activeScenario ? getFacilityScenarioNote(f.id, activeScenario) : null

  return (
    <div className="w-[340px] flex-shrink-0 h-full flex flex-col bg-white border-l border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">
            {facilityTypeIcon(f.facility_type)} {formatFacilityType(f.facility_type)}
          </div>
          <h2 className="text-sm font-bold leading-tight">{f.name}</h2>
          <div className="text-xs text-slate-400 mt-0.5">{f.zone} · {f.owner_type}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white flex-shrink-0 mt-0.5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Score section */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <CircleScore score={f.continuity_risk_score} riskLevel={f.risk_level} />
            <div>
              <div className="text-xs text-gray-500 mb-1">Continuity Risk Score</div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${riskClass}`}>
                {f.risk_level}
              </span>
              <div className="text-[10px] text-gray-400 mt-2">
                Data confidence: <span className="font-semibold">{f.data_confidence_score}/100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scenario alert — shown when a simulation is active and this facility is affected */}
        {scenarioNote && activeScenario && (
          <div
            className="px-4 py-3 border-b"
            style={{ background: activeScenario.color + '12', borderColor: activeScenario.color + '33' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-base">{activeScenario.emoji}</span>
              <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: activeScenario.color }}>
                Simulation: {activeScenario.name}
              </span>
            </div>
            <p className="text-[11px] leading-snug font-medium" style={{ color: activeScenario.color }}>
              {scenarioNote}
            </p>
            <p className="text-[9px] text-gray-400 mt-1">Synthetic scenario — not real data</p>
          </div>
        )}

        {/* Plain-English narrative */}
        <div className="border-b border-gray-100">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
            onClick={() => setNarrativeExpanded(v => !v)}
          >
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              <BookOpen size={10} className="text-blue-500" />
              What This Means
            </span>
            {narrativeExpanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
          </button>
          {narrativeExpanded && (
            <div className="px-4 pb-4">
              {narrative.split('\n\n').map((para, i) => (
                <p key={i} className="text-[11px] text-gray-600 leading-relaxed mb-2 last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Live conditions strip */}
        <div className="px-4 py-3 border-b border-gray-100 bg-slate-50">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            Live Conditions Now
          </div>
          {liveLoading && !live && (
            <p className="text-[10px] text-gray-400">Fetching live data…</p>
          )}
          {live && (
            <div className="space-y-2">
              {/* Road condition + weather row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: CONDITION_COLORS[live.condition_label] }}
                >
                  🛣 Roads: {live.condition_label}
                </span>
                <span className="text-[10px] text-gray-600 flex items-center gap-1">
                  <CloudRain size={10} /> {live.weather_desc}
                </span>
                {live.temperature_c !== null && (
                  <span className="text-[10px] text-gray-500">
                    <Thermometer size={10} className="inline" /> {live.temperature_c}°C
                  </span>
                )}
              </div>

              {/* Precipitation */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                  <div className="text-[9px] text-gray-400 uppercase font-semibold">Rain (1h)</div>
                  <div className={`text-sm font-bold ${live.precipitation_1h_mm > 5 ? 'text-blue-600' : 'text-gray-700'}`}>
                    {live.precipitation_1h_mm} mm
                  </div>
                </div>
                <div className="bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                  <div className="text-[9px] text-gray-400 uppercase font-semibold">Rain (24h)</div>
                  <div className={`text-sm font-bold ${live.precipitation_24h_mm > 15 ? 'text-blue-600' : 'text-gray-700'}`}>
                    {live.precipitation_24h_mm} mm
                  </div>
                </div>
              </div>

              {/* GloFAS flood signal */}
              {live.flood_signal !== 'none' && (
                <div
                  className="flex items-center gap-2 text-[10px] font-semibold px-2 py-1.5 rounded-lg text-white"
                  style={{ backgroundColor: FLOOD_COLORS[live.flood_signal] }}
                >
                  <Waves size={11} />
                  GloFAS flood signal: <strong className="uppercase">{live.flood_signal}</strong>
                  {live.river_discharge_today_m3s && (
                    <span className="font-normal opacity-90">· {live.river_discharge_today_m3s} m³/s</span>
                  )}
                </div>
              )}

              {/* Recent road disruptions */}
              {live.road_disruption_articles_30d > 0 && (
                <div className="text-[10px] text-orange-700">
                  ⚠ {live.road_disruption_articles_30d} road disruption report{live.road_disruption_articles_30d > 1 ? 's' : ''} (30d)
                  {live.road_disruption_headlines[0] && (
                    <p className="text-gray-400 italic truncate mt-0.5">"{live.road_disruption_headlines[0]}"</p>
                  )}
                </div>
              )}

              <p className="text-[9px] text-gray-300 mt-1">
                Open-Meteo · GloFAS satellite+model · GDELT · refreshes every 5 min
              </p>
            </div>
          )}
        </div>

        {/* Live Power Signal strip */}
        {powerDelta && (
          <div className="px-4 py-3 border-b border-gray-100 bg-yellow-50">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />
              Live Power Signal
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: TIER_COLORS[powerDelta.zone_tier] ?? '#94a3b8' }}
              >
                ⚡ {powerDelta.zone_tier}
              </span>
              {powerDelta.feeder_name && (
                <span className="text-[10px] text-gray-600">
                  Feeder: {powerDelta.feeder_name}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-1.5">
              <div className="bg-white rounded-lg px-2 py-1.5 border border-yellow-100">
                <div className="text-[9px] text-gray-400 uppercase font-semibold">Feeder Stress</div>
                <div className={`text-sm font-bold ${powerDelta.feeder_stress > 60 ? 'text-orange-600' : 'text-gray-700'}`}>
                  {powerDelta.feeder_stress}/100
                </div>
              </div>
              <div className="bg-white rounded-lg px-2 py-1.5 border border-yellow-100">
                <div className="text-[9px] text-gray-400 uppercase font-semibold">Power Δ</div>
                <div className="text-sm font-bold text-orange-500">
                  +{powerDelta.delta.toFixed(1)} pts
                </div>
              </div>
            </div>
            {powerAction && (
              <div className="bg-white border border-yellow-200 rounded-lg px-2 py-1.5 text-[10px]">
                <div className="font-semibold text-orange-700 mb-0.5">
                  AI Action · P{powerAction.priority} ·{' '}
                  <span className="font-normal">{powerAction.timeframe.replace('_', ' ')}</span>
                </div>
                <p className="text-gray-700 leading-snug">{powerAction.action}</p>
              </div>
            )}
            <p className="text-[9px] text-gray-400 mt-1">
              Open-Meteo · GDELT · demand model · refreshes every 10 min
            </p>
          </div>
        )}

        {/* Score breakdown */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Score Breakdown
          </div>
          {SCORE_BREAKDOWN_LABELS.map(({ key, label, inverted }) => (
            <ScoreBar
              key={key}
              label={label}
              value={f[key] as number}
              inverted={inverted}
            />
          ))}
        </div>

        {/* Risk drivers */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <AlertTriangle size={10} className="text-orange-500" /> Risk Drivers
          </div>
          {f.main_risk_drivers.map((d, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0 mt-1.5" />
              <span className="text-xs text-gray-700">{d}</span>
            </div>
          ))}
        </div>

        {/* Recommended actions */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <CheckCircle2 size={10} className="text-blue-500" /> Recommended Actions
          </div>
          {f.recommended_actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className="text-[10px] font-bold text-blue-400 flex-shrink-0 mt-0.5">{i + 1}.</span>
              <span className="text-xs text-gray-700">{a}</span>
            </div>
          ))}
        </div>

        {/* Meta */}
        {(f.assumptions.length > 0 || f.data_sources.length > 0) && (
          <div className="px-4 py-3">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Info size={10} className="text-gray-400" /> Data Notes
            </div>
            {f.assumptions.length > 0 && (
              <div className="text-[10px] text-gray-500 mb-1">
                <span className="font-semibold">Assumptions: </span>{f.assumptions.join(' · ')}
              </div>
            )}
            {f.data_sources.length > 0 && (
              <div className="text-[10px] text-gray-500">
                <span className="font-semibold">Sources: </span>{f.data_sources.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
        <p className="text-[9px] text-amber-700 leading-tight">
          Synthetic demo data. Validate with field inspection and official records before operational use.
        </p>
      </div>
    </div>
  )
}
