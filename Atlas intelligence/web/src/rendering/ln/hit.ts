import { INF } from './vector'
import type { Shape } from './shape'
export class Hit {
  constructor(public shape: Shape | null, public t: number) {}
  ok(): boolean { return this.t < INF }
}
export const NO_HIT = new Hit(null, INF)
