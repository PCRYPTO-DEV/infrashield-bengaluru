import { useState, useRef } from 'react'
import { Upload, X, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'
import type { Facility } from '../types'

interface Props {
  onFacilitiesAdded: (facilities: Facility[]) => void
  onClose: () => void
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

export function UploadPanel({ onFacilitiesAdded, onClose }: Props) {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [result, setResult] = useState<{ uploaded: number; failed: number; errors: string[] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.json') && !file.name.endsWith('.geojson')) {
      setStatus('error')
      setResult({ uploaded: 0, failed: 1, errors: ['Only CSV files are supported for upload.'] })
      return
    }

    setStatus('uploading')
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/facilities/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const data = await res.json()
      setResult({ uploaded: data.uploaded, failed: data.failed, errors: data.errors ?? [] })
      setStatus(data.uploaded > 0 ? 'success' : 'error')
      if (data.facilities?.length > 0) onFacilitiesAdded(data.facilities)
    } catch (err: any) {
      setStatus('error')
      setResult({ uploaded: 0, failed: 1, errors: [`Upload failed: ${err.message}. Is the backend running?`] })
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="w-[380px] flex-shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Upload size={14} /> Upload Facility Data
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">CSV with scored columns</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-slate-50'}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={28} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-gray-600 mb-1">Drop a CSV file here</p>
          <p className="text-xs text-gray-400">or click to browse</p>
          <input
            ref={inputRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>

        {/* Status */}
        {status === 'uploading' && (
          <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-4">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-blue-700">Uploading and scoring facilities...</span>
          </div>
        )}

        {status === 'success' && result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={16} className="text-green-600" />
              <span className="text-sm font-semibold text-green-800">{result.uploaded} facilities uploaded</span>
            </div>
            {result.failed > 0 && (
              <p className="text-xs text-amber-700">{result.failed} rows skipped due to errors.</p>
            )}
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.errors.map((e, i) => <li key={i} className="text-xs text-red-600">{e}</li>)}
              </ul>
            )}
          </div>
        )}

        {status === 'error' && result && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-red-600" />
              <span className="text-sm font-semibold text-red-800">Upload failed</span>
            </div>
            {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
          </div>
        )}

        {/* Required columns */}
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={13} className="text-slate-500" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Required CSV Columns</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              'name', 'facility_type', 'latitude', 'longitude', 'zone',
              'criticality_score', 'power_dependency_score', 'backup_readiness_score',
              'flood_exposure_score', 'water_dependency_score', 'road_access_score',
              'heat_exposure_score', 'data_confidence_score',
            ].map((col) => (
              <div key={col} className="text-[10px] font-mono text-slate-600 bg-white rounded px-1.5 py-0.5 border border-slate-200">
                {col}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">All score columns accept values 0–100.</p>
        </div>
      </div>

      <div className="px-5 py-3 bg-amber-50 border-t border-amber-100">
        <p className="text-[9px] text-amber-700">
          Uploaded data is scored using the synthetic model. Validate all results before operational use.
        </p>
      </div>
    </div>
  )
}
