// Simulation control bar — floats at bottom of map.
// Lets users activate synthetic disaster scenarios and watch facilities change.
import { useEffect, useState } from 'react'
import { SCENARIOS, type Scenario } from '../data/scenarios'
import { X, Play, Square, RefreshCw, Zap, Waves, Thermometer, AlertCircle } from 'lucide-react'

interface Props {
  activeScenario: Scenario | null
  onActivate: (s: Scenario) => void
  onReset: () => void
}

const SCENARIO_ICONS: Record<string, React.ElementType> = {
  S001: Waves,
  S002: Zap,
  S003: AlertCircle,
  S004: Thermometer,
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  severe:   'bg-amber-500 text-white',
  moderate: 'bg-orange-500 text-white',
}

export function SimulationBar({ activeScenario, onActivate, onReset }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)

  // Timer for active scenario
  useEffect(() => {
    if (!activeScenario) { setElapsed(0); setStartTime(null); return }
    setStartTime(Date.now())
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - Date.now()) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [activeScenario])

  useEffect(() => {
    if (!startTime) return
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [startTime])

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
      {/* Scenario detail strip (shown when active) */}
      {activeScenario && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl max-w-[640px] border"
          style={{
            background: 'rgba(15,23,42,0.97)',
            borderColor: activeScenario.color + '55',
            backdropFilter: 'blur(12px)',
          }}
        >
          <span className="text-2xl flex-shrink-0 mt-0.5">{activeScenario.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-bold text-sm">{activeScenario.name}</span>
              <span
                className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: activeScenario.color + '33', color: activeScenario.color }}
              >
                {activeScenario.severity}
              </span>
              <span className="text-xs font-mono text-slate-400 ml-auto pl-4">
                ⏱ {fmt(elapsed)}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-snug">{activeScenario.description}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              {activeScenario.overrides.length} facilities affected ·{' '}
              {Object.values(activeScenario.corridor_statuses).filter(s => s === 'blocked').length} corridors blocked ·{' '}
              {Object.values(activeScenario.corridor_statuses).filter(s => s === 'degraded').length} corridors degraded
            </p>
          </div>
          <button
            onClick={onReset}
            className="flex-shrink-0 text-slate-500 hover:text-white transition-colors mt-0.5"
            title="Reset simulation"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Scenario selector pill */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-2xl shadow-2xl border border-slate-800"
        style={{ background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)' }}
      >
        {/* Label */}
        <div className="flex items-center gap-1.5 pl-1 pr-2 border-r border-slate-800">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
            Sim Scenarios
          </span>
        </div>

        {/* Scenario buttons */}
        {SCENARIOS.map(s => {
          const Icon = SCENARIO_ICONS[s.id] ?? Zap
          const isActive = activeScenario?.id === s.id
          return (
            <button
              key={s.id}
              onClick={() => isActive ? onReset() : onActivate(s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
              style={
                isActive
                  ? { background: s.color + '25', color: s.color, border: `1px solid ${s.color}55` }
                  : { color: '#94a3b8', border: '1px solid transparent' }
              }
              title={s.tagline}
            >
              <Icon size={11} />
              <span className="hidden sm:inline">{s.name}</span>
              <span className="sm:hidden">{s.emoji}</span>
              {isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: s.color }}
                />
              )}
            </button>
          )
        })}

        {/* Reset */}
        {activeScenario && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-800 text-[11px] text-slate-500 hover:text-white transition-colors"
          >
            <RefreshCw size={11} />
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>

      {/* Synthetic data disclaimer */}
      <p className="text-[9px] text-slate-600 text-center">
        🧪 Synthetic simulation — for demonstration only
      </p>
    </div>
  )
}
