import { Shield, Filter, Layers, BarChart3, Upload, FileText, AlertCircle, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { useState } from 'react'
import type { Facility, FilterState, LayerState, RiskLevel } from '../types'
import { ALL_FACILITY_TYPES, ALL_RISK_LEVELS, ZONES } from '../types'
import { RISK_COLORS, formatFacilityType } from '../utils/colors'

interface Props {
  facilities: Facility[]
  filters: FilterState
  layers: LayerState
  activePanel: string
  onFiltersChange: (f: FilterState) => void
  onLayersChange: (l: LayerState) => void
  onPanelChange: (p: string) => void
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-500' : 'bg-slate-600'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function NavBtn({ icon: Icon, label, panel, active, onClick }: { icon: any; label: string; panel: string; active: boolean; onClick: (p: string) => void }) {
  return (
    <button
      onClick={() => onClick(active ? 'map' : panel)}
      className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

export function Sidebar({ facilities, filters, layers, activePanel, onFiltersChange, onLayersChange, onPanelChange }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [layersOpen, setLayersOpen] = useState(false)

  const critical = facilities.filter((f) => f.risk_level === 'Critical').length
  const high = facilities.filter((f) => f.risk_level === 'High').length
  const insufficient = facilities.filter((f) => f.risk_level === 'Insufficient Data').length

  const toggleRiskLevel = (level: RiskLevel) => {
    const current = filters.riskLevels
    const next = current.includes(level) ? current.filter((r) => r !== level) : [...current, level]
    onFiltersChange({ ...filters, riskLevels: next })
  }

  const toggleFacilityType = (type: string) => {
    const current = filters.facilityTypes
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    onFiltersChange({ ...filters, facilityTypes: next })
  }

  return (
    <div className="w-[280px] flex-shrink-0 bg-slate-900 text-white flex flex-col h-full overflow-hidden border-r border-slate-800">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Shield size={14} />
          </div>
          <div>
            <div className="text-xs font-black tracking-tight leading-tight">POLYMATH INFRASHIELD</div>
            <div className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase">Bengaluru</div>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-1 leading-tight">
          Critical infrastructure continuity intelligence
        </p>
      </div>

      {/* Stats strip */}
      <div className="px-4 py-3 border-b border-slate-800 grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold text-white">{facilities.length}</div>
          <div className="text-[9px] text-slate-500 uppercase font-semibold">Total</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-red-400">{critical}</div>
          <div className="text-[9px] text-slate-500 uppercase font-semibold">Critical</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-orange-400">{high}</div>
          <div className="text-[9px] text-slate-500 uppercase font-semibold">High</div>
        </div>
      </div>

      {/* Nav buttons */}
      <div className="px-3 py-3 border-b border-slate-800 space-y-1">
        <NavBtn icon={BarChart3} label="Top 10 Risk Facilities" panel="topRisk" active={activePanel === 'topRisk'} onClick={onPanelChange} />
        <NavBtn icon={Zap} label="⚡ Power Intelligence" panel="power" active={activePanel === 'power'} onClick={onPanelChange} />
        <NavBtn icon={Zap} label="Auto-fill from Polymath" panel="pipeline" active={activePanel === 'pipeline'} onClick={onPanelChange} />
        <NavBtn icon={Upload} label="Upload Data" panel="upload" active={activePanel === 'upload'} onClick={onPanelChange} />
        <NavBtn icon={FileText} label="Risk Report" panel="report" active={activePanel === 'report'} onClick={onPanelChange} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Filters */}
        <div className="border-b border-slate-800">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider hover:text-white"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5"><Filter size={11} /> Filters</span>
            {filtersOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {filtersOpen && (
            <div className="px-4 pb-4 space-y-4">
              {/* Risk levels */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">Risk Level</div>
                {ALL_RISK_LEVELS.map((level) => (
                  <label key={level} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.riskLevels.length === 0 || filters.riskLevels.includes(level)}
                      onChange={() => toggleRiskLevel(level)}
                      className="w-3 h-3 accent-blue-500"
                    />
                    <span className="flex items-center gap-1.5 text-xs text-slate-300">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RISK_COLORS[level] }} />
                      {level}
                    </span>
                  </label>
                ))}
              </div>

              {/* Zone */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">Zone</div>
                <select
                  value={filters.zone}
                  onChange={(e) => onFiltersChange({ ...filters, zone: e.target.value })}
                  className="w-full bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500"
                >
                  {ZONES.map((z) => (
                    <option key={z} value={z === 'All Zones' ? '' : z}>{z}</option>
                  ))}
                </select>
              </div>

              {/* Facility type */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">
                  Facility Type
                  {filters.facilityTypes.length > 0 && (
                    <button onClick={() => onFiltersChange({ ...filters, facilityTypes: [] })} className="ml-2 text-blue-400 lowercase normal-case tracking-normal font-normal">(clear)</button>
                  )}
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {ALL_FACILITY_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.facilityTypes.length === 0 || filters.facilityTypes.includes(type)}
                        onChange={() => toggleFacilityType(type)}
                        className="w-3 h-3 accent-blue-500"
                      />
                      <span className="text-xs text-slate-400">{formatFacilityType(type)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Data confidence */}
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">
                  Min. Data Confidence: <span className="text-blue-400">{filters.minConfidence}</span>
                </div>
                <input
                  type="range" min={0} max={100} step={5}
                  value={filters.minConfidence}
                  onChange={(e) => onFiltersChange({ ...filters, minConfidence: Number(e.target.value) })}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                  <span>0</span><span>50</span><span>100</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Layers */}
        <div className="border-b border-slate-800">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider hover:text-white"
            onClick={() => setLayersOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5"><Layers size={11} /> Map Layers</span>
            {layersOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {layersOpen && (
            <div className="px-4 pb-4 space-y-3">
              {([
                ['facilities',       'Facilities'],
                ['powerAssets',      'Power Assets'],
                ['ghostCorridors',   '🚑 Ghost Corridors (Ambulance)'],
                ['powerStress',      '⚡ Power Stress Zones'],
                ['floodZones',       'Flood Risk Zones'],
                ['waterStress',      'Water Stress Zones'],
                ['roadAccess',       'Road Access Risk'],
                ['heatZones',        'Heat Exposure Zones'],
                ['satelliteThermal', '🛰 NASA · Thermal Anomalies'],
                ['satelliteFlood',   '🛰 NASA · Flood Detection'],
                ['nightLights',      '🛰 NASA · Night Lights'],
              ] as [keyof LayerState, string][]).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{label}</span>
                  <Toggle
                    checked={layers[key]}
                    onChange={(v) => onLayersChange({ ...layers, [key]: v })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Insufficient data notice */}
        {insufficient > 0 && (
          <div className="mx-3 my-3 bg-amber-900/30 border border-amber-700/40 rounded-lg px-3 py-2.5 flex items-start gap-2">
            <AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-300 leading-tight">
              {insufficient} facilities have insufficient data confidence and may not appear in ranked views.
            </p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-950">
        <p className="text-[9px] text-slate-600 leading-relaxed">
          This MVP uses public, open, and synthetic demonstration data. Scores are decision-support indicators only and must be validated through field inspection, operator data, and official agency records before operational use.
        </p>
      </div>
    </div>
  )
}
