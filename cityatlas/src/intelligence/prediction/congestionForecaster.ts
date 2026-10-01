import type { IntelligenceModule, CongestionForecast, FlowReport } from '../types'

/**
 * Simple, explainable congestion forecast: a damped linear trend fitted to
 * the recent congestion history of each edge. Confidence decays with
 * horizon. Replace with a learned model only when a baseline this simple
 * is demonstrably beaten.
 */
export const CongestionForecaster: IntelligenceModule<{ flow: FlowReport; horizonsMin?: number[] }, CongestionForecast> = {
  id: 'congestion-forecast/1',
  async process({ flow, horizonsMin = [10, 30] }, ctx) {
    const hist = ctx.history.flows
    const edges = new Map<string, number[]>()
    const samples = hist.length
    for (const f of flow.edges.values()) {
      const series = hist.map((h) => h.edges.get(f.edgeId)?.congestion ?? 0)
      let slope = 0
      if (series.length >= 3) {
        const n = series.length, xm = (n - 1) / 2, ym = series.reduce((s, v) => s + v, 0) / n
        let num = 0, den = 0
        for (let i = 0; i < n; i++) { num += (i - xm) * (series[i] - ym); den += (i - xm) ** 2 }
        slope = den ? num / den : 0
      }
      const dtSamples = Math.max(1, (hist.length >= 2 ? (hist[hist.length - 1].time - hist[0].time) / (hist.length - 1) : 2000) / 60000) // minutes per sample
      edges.set(f.edgeId, horizonsMin.map((h) => {
        const steps = h / dtSamples
        const damped = slope * steps * Math.exp(-h / 40)
        return Math.max(0, Math.min(1, f.congestion + damped))
      }))
    }
    const confidence = horizonsMin.map((h) => Math.max(0.15, Math.min(0.8, 0.3 + 0.05 * Math.min(samples, 10)) * Math.exp(-h / 45)))
    return { time: flow.time, horizonsMin, edges, confidence, evidence: { classification: 'predicted', model: 'congestion-forecast/1', timestamp: flow.time, confidence: confidence[0] } }
  },
}
