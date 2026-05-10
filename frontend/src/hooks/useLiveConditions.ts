import { useState, useEffect } from 'react'

export interface LiveConditions {
  condition_label: 'Clear' | 'Degraded' | 'Compromised' | 'Severe'
  condition_score: number
  weather_desc: string
  weather_code: number
  is_severe_weather: boolean
  precipitation_1h_mm: number
  precipitation_24h_mm: number
  temperature_c: number | null
  flood_signal: 'none' | 'elevated' | 'high' | 'critical'
  river_discharge_today_m3s: number | null
  discharge_anomaly_pct: number | null
  road_disruption_articles_30d: number
  road_disruption_headlines: string[]
  data_sources: string[]
}

const CONDITION_COLORS: Record<string, string> = {
  Clear:       '#22c55e',
  Degraded:    '#f59e0b',
  Compromised: '#f97316',
  Severe:      '#ef4444',
}

const FLOOD_COLORS: Record<string, string> = {
  none:     '#22c55e',
  elevated: '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
}

export { CONDITION_COLORS, FLOOD_COLORS }

/**
 * Fetches live road + weather conditions for a facility from the backend.
 * Refreshes every 5 minutes.
 */
export function useLiveConditions(
  lat: number,
  lng: number,
  zone: string,
  enabled: boolean = true,
) {
  const [data, setData]       = useState<LiveConditions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const fetch_ = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          lat: lat.toString(),
          lng: lng.toString(),
          zone,
        })
        const res = await fetch(`/api/live/conditions?${params}`)
        if (!res.ok) throw new Error(`${res.status}`)
        const json: LiveConditions = await res.json()
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch_()
    const id = setInterval(fetch_, 5 * 60 * 1000)   // refresh every 5 min
    return () => { cancelled = true; clearInterval(id) }
  }, [lat, lng, zone, enabled])

  return { data, loading, error }
}
