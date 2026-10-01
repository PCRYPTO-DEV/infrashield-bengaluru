import type { Lod } from './svg/chunkSvg'
export type { Lod }

export const LOD_ORDER: Lod[] = ['city', 'neighbourhood', 'street']

/** Zoom-based LOD. */
export function lodForZoom(zoom: number): Lod {
  if (zoom < 14.4) return 'city'
  if (zoom < 16) return 'neighbourhood'
  return 'street'
}

/**
 * Performance-budgeted LOD: if frames consistently exceed the budget, the
 * controller demotes one level; it promotes back when frames are cheap.
 */
export class LodController {
  private over = 0
  private under = 0
  demotion = 0
  constructor(private budgetMs = 20) {}

  report(frameMs: number): void {
    if (frameMs > this.budgetMs) { this.over++; this.under = 0 } else { this.under++; this.over = 0 }
    if (this.over >= 30 && this.demotion < 2) { this.demotion++; this.over = 0 }
    if (this.under >= 180 && this.demotion > 0) { this.demotion--; this.under = 0 }
  }

  lod(zoom: number): Lod {
    const i = LOD_ORDER.indexOf(lodForZoom(zoom))
    return LOD_ORDER[Math.max(0, i - this.demotion)]
  }
}
