import type { IntelligenceContext, IntelligenceHistory, IntelligenceState } from './types'
import type { WorldModel } from '../engine/world/WorldModel'
import type { SimSnapshot } from '../engine/simulation/snapshot'
import { TrafficFlowAnalyzer } from './analytics/trafficFlowAnalyzer'
import { DensityAnalyzer } from './analytics/densityAnalyzer'
import { UrbanActivityAnalyzer } from './analytics/urbanActivityAnalyzer'
import { AnomalyDetector } from './anomaly/anomalyDetector'
import { RouteRiskAnalyzer } from './analytics/routeRiskAnalyzer'
import { CongestionForecaster } from './prediction/congestionForecaster'
import { MovementPredictor } from './prediction/movementPredictor'
import type { MonitoringZone } from '../zones/types'

/**
 * Raw observations → normalisation → spatial aggregation → temporal
 * aggregation → feature extraction → anomaly detection → prediction →
 * explanation. Modules are independent; this is only the wiring.
 */
export class IntelligencePipeline {
  readonly history: IntelligenceHistory = { flows: [], densities: [], maxLength: 30 }
  state: IntelligenceState = { anomalies: [], predictions: new Map(), lastRun: 0 }
  private running = false

  constructor(private world: WorldModel) {}

  context(time: number): IntelligenceContext {
    return { time, graph: this.world.graph, world: this.world, unitPerMetre: this.world.unitPerMetre, history: this.history }
  }

  async run(snapshot: SimSnapshot, zones: MonitoringZone[], predictFor: number[]): Promise<IntelligenceState> {
    if (this.running) return this.state
    this.running = true
    try {
      const ctx = this.context(snapshot.time)
      const flow = await TrafficFlowAnalyzer.process(snapshot, ctx)
      const density = await DensityAnalyzer.process({ agents: this.world.allAgents(), time: snapshot.time }, ctx)
      this.history.flows.push(flow); if (this.history.flows.length > this.history.maxLength) this.history.flows.shift()
      this.history.densities.push(density); if (this.history.densities.length > this.history.maxLength) this.history.densities.shift()
      const activity = await UrbanActivityAnalyzer.process({ density, flow, time: snapshot.time }, ctx)
      const anomalies = await AnomalyDetector.process({ time: snapshot.time, agents: this.world.allAgents(), flow, density, zones }, ctx)
      const risk = await RouteRiskAnalyzer.process({ flow, density, time: snapshot.time }, ctx)
      const forecast = await CongestionForecaster.process({ flow }, ctx)
      const predictions = new Map<number, Awaited<ReturnType<typeof MovementPredictor.process>>>()
      for (const id of predictFor) { const a = this.world.agents.get(id); if (a) predictions.set(id, await MovementPredictor.process({ agent: a, horizonS: 45 }, ctx)) }
      this.state = { flow, density, activity, anomalies, risk, forecast, predictions, lastRun: snapshot.time }
      return this.state
    } finally {
      this.running = false
    }
  }

  async predict(agentId: number, horizonS = 45) {
    const a = this.world.agents.get(agentId)
    if (!a) return undefined
    return MovementPredictor.process({ agent: a, horizonS }, this.context(this.world.snapshotTime))
  }

  reset(): void {
    this.history.flows = []
    this.history.densities = []
    this.state = { anomalies: [], predictions: new Map(), lastRun: 0 }
  }
}
