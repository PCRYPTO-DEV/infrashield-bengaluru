import { RISK_COLORS } from '../utils/colors'
import type { RiskLevel } from '../types'

const LEVELS: { level: RiskLevel; label: string; range: string }[] = [
  { level: 'Critical', label: 'Critical', range: '76–100' },
  { level: 'High', label: 'High', range: '56–75' },
  { level: 'Medium', label: 'Medium', range: '31–55' },
  { level: 'Low', label: 'Low', range: '0–30' },
  { level: 'Insufficient Data', label: 'Insufficient Data', range: '—' },
]

export function ScoreLegend() {
  return (
    <div className="absolute bottom-8 left-[288px] z-[1000] bg-white rounded-lg shadow-lg border border-gray-200 p-3 min-w-[190px]">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
        Continuity Risk Score
      </div>
      {LEVELS.map(({ level, label, range }) => (
        <div key={level} className="flex items-center gap-2 mb-1.5">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: RISK_COLORS[level] }}
          />
          <span className="text-xs text-gray-700 font-medium">{label}</span>
          <span className="text-[10px] text-gray-400 ml-auto">{range}</span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-gray-100 text-[9px] text-gray-400 leading-tight">
        SYNTHETIC DEMO DATA — not for operational use
      </div>
    </div>
  )
}
