import { useState, useEffect, useCallback } from 'react'
import { Zap, RefreshCw, AlertTriangle, Clock, ChevronRight, Thermometer, BarChart2 } from 'lucide-react'
import type { PowerActionPlan, PowerScoreDelta } from '../types'

const API = 'http://localhost:8003'

const CONFIDENCE_COLORS = { HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#94a3b8' }
const TIMEFRAME_LABELS = { immediate: '🚨 Immediate', this_week: '📅 This Week', this_month: '📋 This Month' }
const TIER_COLORS = { LOW: '#22c55e', ELEVATED: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#7f1d1d' }

interface Props {
  visible: boolean
}

export function PowerActionsPanel({ visible }: Props) {
  const [plans, setPlans] = useState<PowerActionPlan[]>([])
  const [deltas, setDeltas] = useState<PowerScoreDelta[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeZone, setActiveZone] = useState<string | null>(null)

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      if (forceRefresh) {
        setRefreshing(true)
        await fetch(`${API}/power/refresh`, { method: 'POST' })
        setRefreshing(false)
      }
      const [plansRes, deltasRes] = await Promise.all([
        fetch(`${API}/power/actions`),
        fetch(`${API}/power/score-deltas`),
      ])
      const plansData = await plansRes.json()
      const deltasData = await deltasRes.json()
      setPlans(plansData.action_plans ?? [])
      setDeltas(deltasData.deltas ?? [])
      setRefreshedAt(plansData.refreshed_at ?? deltasData.refreshed_at ?? null)
    } catch (e) {
      setError('Could not reach power intelligence backend')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (visible) fetchData()
  }, [visible, fetchData])

  if (!visible) return null

  const zones = [...new Set(deltas.map(d => d.zone))].sort()
  const filteredPlans = activeZone ? plans.filter(p => p.zone === activeZone) : plans
  const filteredDeltas = activeZone ? deltas.filter(d => d.zone === activeZone) : deltas
  const topDeltas = [...filteredDeltas].sort((a, b) => b.delta - a.delta).slice(0, 5)

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header strip */}
      <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-yellow-400" />
          <span className="text-xs font-bold text-white">Power Intelligence</span>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {refreshedAt && (
        <div className="px-4 py-1 text-[9px] text-slate-500 border-b border-slate-800">
          Last updated: {new Date(refreshedAt).toLocaleTimeString()}
        </div>
      )}

      {error && (
        <div className="mx-3 my-2 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-300">{error}</p>
        </div>
      )}

      {loading && !refreshing && (
        <div className="px-4 py-6 text-center text-[11px] text-slate-500">
          <div className="animate-pulse">Loading power stress data…</div>
        </div>
      )}

      {!loading && (
        <>
          {/* Zone filter pills */}
          {zones.length > 0 && (
            <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-slate-800">
              <button
                onClick={() => setActiveZone(null)}
                className={`text-[9px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
                  activeZone === null ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >All</button>
              {zones.map(z => (
                <button
                  key={z}
                  onClick={() => setActiveZone(activeZone === z ? null : z)}
                  className={`text-[9px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
                    activeZone === z ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {z.split('/')[0].trim()}
                </button>
              ))}
            </div>
          )}

          {/* Top affected facilities */}
          {topDeltas.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-800">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <BarChart2 size={10} className="text-yellow-400" /> Highest Power Delta
              </div>
              {topDeltas.map(d => (
                <div key={d.facility_id} className="flex items-center gap-2 mb-1.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: TIER_COLORS[d.zone_tier] ?? '#94a3b8' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-slate-300 truncate font-medium">{d.facility_name}</div>
                    <div className="text-[9px] text-slate-500">
                      {d.feeder_name ?? d.feeder_id ?? 'Unknown feeder'} · stress {d.feeder_stress}/100
                    </div>
                  </div>
                  <div className="text-[10px] font-bold text-orange-400 flex-shrink-0">
                    +{d.delta.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action plans */}
          <div className="px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <AlertTriangle size={10} className="text-orange-400" /> AI Action Plans
              {plans.length > 0 && (
                <span className="ml-1 text-[9px] normal-case text-slate-600">({plans.length} plans)</span>
              )}
            </div>

            {filteredPlans.length === 0 && (
              <p className="text-[10px] text-slate-500 italic">
                {plans.length === 0
                  ? 'No action plans yet — click Refresh to generate'
                  : 'No plans for this zone'}
              </p>
            )}

            {filteredPlans.map((p, i) => (
              <div
                key={`${p.facility_id}-${i}`}
                className="mb-3 bg-slate-800 rounded-lg p-3 border border-slate-700"
              >
                <div className="flex items-start gap-2 mb-1.5">
                  <span className="text-[10px] font-black text-slate-600 flex-shrink-0 mt-0.5">
                    P{p.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-white leading-tight">{p.facility_name}</div>
                    <div className="text-[9px] text-slate-500">{p.zone}</div>
                  </div>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      backgroundColor: (CONFIDENCE_COLORS[p.confidence] ?? '#94a3b8') + '22',
                      color: CONFIDENCE_COLORS[p.confidence] ?? '#94a3b8',
                    }}
                  >
                    {p.confidence}
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 leading-snug mb-1.5">{p.action}</p>
                <p className="text-[9px] text-slate-500 leading-snug italic mb-1.5">{p.rationale}</p>
                <div className="flex items-center gap-1 text-[9px] text-slate-600">
                  <Clock size={9} />
                  {TIMEFRAME_LABELS[p.timeframe] ?? p.timeframe}
                </div>
              </div>
            ))}
          </div>

          {/* Data note */}
          <div className="px-4 pb-4 pt-0">
            <p className="text-[9px] text-slate-600 leading-relaxed">
              Stress: Open-Meteo thermal · GDELT outage history · time-model footfall.
              LLM plans cached 4h. Click Refresh to force update.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
