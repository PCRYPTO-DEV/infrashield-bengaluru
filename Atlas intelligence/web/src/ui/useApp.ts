import { useSyncExternalStore } from 'react'
import type { CityAtlas } from '../app/CityAtlas'

/** Subscribe React to the app's version counter; re-renders are cheap UI only. */
export function useAppVersion(app: CityAtlas): number {
  return useSyncExternalStore((fn) => app.subscribe(fn), () => app.getVersion(), () => app.getVersion())
}
