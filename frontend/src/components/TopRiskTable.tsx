import { X, TrendingUp } from 'lucide-react'
import type { Facility } from '../types'
import { RISK_BG_CLASSES, facilityTypeIcon, formatFacilityType } from '../utils/colors'

interface Props {
  facilities: Facility[]
  onSelectFacility: (f: Facility) => void
  onClose: () => void
}

export function TopRiskTable({ facilities, onSelectFacility, onClose }: Props) {
  const top10 = [...facilities]
    .filter((f) => f.risk_level !== 'Insufficient Data')
    .sort((a, b) => b.continuity_risk_score - a.continuity_risk_score)
    .slice(0, 10)

  return (
    <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp size={18} className="text-red-400" />
            <div>
              <h2 className="text-base font-bold">Top 10 Highest-Risk Facilities</h2>
              <p className="text-xs text-slate-400">Ranked by Continuity Risk Score — SYNTHETIC DEMO DATA</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase w-8">#</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Facility</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Zone</th>
                <th className="px-4 py-2.5 text-left text-xs font-bold text-gray-500 uppercase">Type</th>
                <th className="px-4 py-2.5 text-right text-xs font-bold text-gray-500 uppercase">CRS</th>
                <th className="px-4 py-2.5 text-center text-xs font-bold text-gray-500 uppercase">Risk</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((f, i) => (
                <tr
                  key={f.id}
                  className="border-b border-gray-100 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => { onSelectFacility(f); onClose() }}
                >
                  <td className="px-4 py-3 text-gray-400 font-bold text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800 text-sm">{f.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{f.owner_type}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{f.zone}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-600">
                      {facilityTypeIcon(f.facility_type)} {formatFacilityType(f.facility_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-base font-bold text-slate-800">{f.continuity_risk_score}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${RISK_BG_CLASSES[f.risk_level]}`}>
                      {f.risk_level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            Click any row to view the full risk card. Facilities with insufficient data confidence are excluded from this ranking.
          </p>
        </div>
      </div>
    </div>
  )
}
