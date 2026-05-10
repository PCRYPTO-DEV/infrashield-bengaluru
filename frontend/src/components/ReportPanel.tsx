import { useState } from 'react'
import { X, FileText, Download, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { Facility, ReportSummary } from '../types'
import { RISK_BG_CLASSES } from '../utils/colors'

interface Props {
  facilities: Facility[]
  onClose: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-gray-100 pb-1.5 mb-2">
        {title}
      </h3>
      {children}
    </div>
  )
}

function buildClientReport(facilities: Facility[]): ReportSummary {
  const sorted = [...facilities].sort((a, b) => b.continuity_risk_score - a.continuity_risk_score)
  const critical = facilities.filter((f) => f.risk_level === 'Critical')
  const high = facilities.filter((f) => f.risk_level === 'High')
  const medium = facilities.filter((f) => f.risk_level === 'Medium')
  const low = facilities.filter((f) => f.risk_level === 'Low')
  const insuff = facilities.filter((f) => f.risk_level === 'Insufficient Data')

  const zoneGroups: Record<string, Facility[]> = {}
  facilities.forEach((f) => {
    if (!zoneGroups[f.zone]) zoneGroups[f.zone] = []
    zoneGroups[f.zone].push(f)
  })

  const zone_risk_summary: ReportSummary['zone_risk_summary'] = {}
  Object.entries(zoneGroups).forEach(([zone, items]) => {
    const scored = items.filter((i) => i.risk_level !== 'Insufficient Data')
    if (!scored.length) return
    const best = scored.reduce((a, b) => a.continuity_risk_score > b.continuity_risk_score ? a : b)
    zone_risk_summary[zone] = {
      count: items.length,
      avg_score: Math.round(scored.reduce((s, i) => s + i.continuity_risk_score, 0) / scored.length * 10) / 10,
      top_facility: best.name,
      top_score: best.continuity_risk_score,
    }
  })

  return {
    generated_at: new Date().toISOString(),
    total_facilities: facilities.length,
    critical_count: critical.length,
    high_count: high.length,
    medium_count: medium.length,
    low_count: low.length,
    insufficient_data_count: insuff.length,
    top_10_facilities: sorted.filter((f) => f.risk_level !== 'Insufficient Data').slice(0, 10),
    zone_risk_summary,
    critical_themes: [
      'Power dependency without verified backup is the dominant risk factor across hospitals and water utilities.',
      'Flood exposure in Bellandur, Electronic City, Majestic, and KR Puram compounds infrastructure risk.',
      'Emergency access degradation during monsoon and peak traffic threatens response times.',
      'Water pumping stations face critical single-point-of-failure risk on power supply.',
    ],
    data_confidence_gaps: [
      'Backup generator runtime not confirmed for 60%+ of facilities.',
      'BESCOM feeder dependency data not independently verified.',
      'BWSSB pumping station backup data unavailable in public domain.',
    ],
    verification_checklist: [
      'Confirm DG capacity and fuel reserve for Critical-rated hospitals.',
      'Verify BESCOM feeder dependency for all power substations.',
      'Inspect BWSSB pumping station power redundancy.',
      'Survey road access at peak hours for Critical and High facilities.',
      'Obtain official flood maps from BBMP/KSNDMC.',
    ],
    actions_30_day: [
      'Compile district-level facility registry with operator contacts.',
      'Initiate RTI for BESCOM feeder maps and BWSSB pumping data.',
      'Conduct tabletop exercise with top 10 Critical/High facilities.',
    ],
    actions_90_day: [
      'Integrate BESCOM feeder reliability data into scoring model.',
      'Replace synthetic flood zones with BBMP/KSNDMC-verified GIS data.',
      'Develop Business Continuity Plans for Critical-rated assets.',
    ],
    disclaimer: 'This report uses synthetic demonstration data. Validate before operational use.',
  }
}

export function ReportPanel({ facilities, onClose }: Props) {
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const generateReport = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/report/summary')
      if (!res.ok) throw new Error('backend unavailable')
      const data = await res.json()
      setReport(data)
    } catch {
      // Fall back to client-side report generation
      setReport(buildClientReport(facilities))
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = async () => {
    try {
      const res = await fetch('/api/export/facilities.csv')
      if (!res.ok) throw new Error('backend unavailable')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'infrashield_facilities.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Client-side CSV fallback
      const headers = 'id,name,facility_type,zone,continuity_risk_score,risk_level\n'
      const rows = facilities.map((f) =>
        `${f.id},"${f.name}",${f.facility_type},${f.zone},${f.continuity_risk_score},${f.risk_level}`
      ).join('\n')
      const blob = new Blob([`# SYNTHETIC DEMO DATA\n${headers}${rows}`], { type: 'text/csv' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'infrashield_facilities.csv'
      a.click()
    }
  }

  const downloadHTML = async () => {
    try {
      const res = await fetch('/api/export/report.html')
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'infrashield_report.html'
      a.click()
    } catch {
      alert('Start the backend to download the full HTML report.')
    }
  }

  return (
    <div className="w-[420px] flex-shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <FileText size={14} /> Continuity Risk Report
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Executive decision-support summary</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      {/* Actions bar */}
      <div className="flex gap-2 p-4 border-b border-gray-100">
        <button
          onClick={generateReport}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg px-3 py-2.5 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {report ? 'Refresh Report' : 'Generate Report'}
        </button>
        <button
          onClick={downloadCSV}
          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg px-3 py-2.5 transition-colors"
        >
          <Download size={13} /> CSV
        </button>
        <button
          onClick={downloadHTML}
          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg px-3 py-2.5 transition-colors"
        >
          <Download size={13} /> HTML
        </button>
      </div>

      {!report && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <FileText size={40} className="text-gray-200 mb-4" />
          <p className="text-sm font-semibold text-gray-500 mb-1">No report generated yet</p>
          <p className="text-xs text-gray-400">Click "Generate Report" to create an executive risk summary</p>
        </div>
      )}

      {report && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="text-[9px] text-gray-400 mb-4">
            Generated: {new Date(report.generated_at).toLocaleString()} · SYNTHETIC DEMO DATA
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-2 mb-5">
            {[
              { label: 'Total', value: report.total_facilities, color: 'text-slate-800' },
              { label: 'Critical', value: report.critical_count, color: 'text-red-600' },
              { label: 'High', value: report.high_count, color: 'text-orange-600' },
              { label: 'Medium', value: report.medium_count, color: 'text-yellow-600' },
              { label: 'Low', value: report.low_count, color: 'text-green-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 rounded-lg p-2 text-center border border-gray-100">
                <div className={`text-lg font-bold ${color}`}>{value}</div>
                <div className="text-[9px] text-gray-500 uppercase font-semibold">{label}</div>
              </div>
            ))}
          </div>

          <Section title="Top 10 Vulnerable Facilities">
            {report.top_10_facilities.map((f, i) => (
              <div key={f.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-300 w-5">{i + 1}</span>
                  <div>
                    <div className="text-xs font-semibold text-slate-700">{f.name}</div>
                    <div className="text-[10px] text-gray-400">{f.zone}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-slate-800">{f.continuity_risk_score}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${RISK_BG_CLASSES[f.risk_level]}`}>
                    {f.risk_level}
                  </span>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Critical Dependency Themes">
            {report.critical_themes.map((t, i) => (
              <div key={i} className="flex items-start gap-2 mb-2">
                <AlertTriangle size={10} className="text-orange-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700">{t}</p>
              </div>
            ))}
          </Section>

          <Section title="Data Confidence Gaps">
            {report.data_confidence_gaps.map((g, i) => (
              <p key={i} className="text-xs text-gray-600 mb-1">• {g}</p>
            ))}
          </Section>

          <Section title="30-Day Actions">
            {report.actions_30_day.map((a, i) => (
              <div key={i} className="flex items-start gap-2 mb-1.5">
                <CheckCircle2 size={10} className="text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700">{a}</p>
              </div>
            ))}
          </Section>

          <Section title="90-Day Actions">
            {report.actions_90_day.map((a, i) => (
              <div key={i} className="flex items-start gap-2 mb-1.5">
                <CheckCircle2 size={10} className="text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700">{a}</p>
              </div>
            ))}
          </Section>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mt-2">
            <p className="text-[10px] text-amber-700 leading-relaxed">{report.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
  )
}
