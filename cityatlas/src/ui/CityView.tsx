import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../app/CityAtlas'

/** Mounts the renderers and translates pointer/keyboard input into camera and app calls. React never touches the city DOM. */
export function CityView({ app }: { app: CityAtlas }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    const el = ref.current!
    app.mount(el)
    let down: { x: number; y: number; moved: boolean } | null = null
    // Touch: track active pointers so two fingers pinch-zoom around their midpoint.
    const touches = new Map<number, { x: number; y: number }>()
    let pinchDist = 0
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      el.setPointerCapture(e.pointerId)
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); down = null; setDragging(false); return }
      down = { x: e.clientX, y: e.clientY, moved: false }
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) app.camera.zoomAt({ x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, Math.log2(d / pinchDist))
        pinchDist = d
        return
      }
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y
        if (!down.moved && Math.hypot(dx, dy) > 3) { down.moved = true; setDragging(true) }
        if (down.moved) { app.camera.panByPixels(dx, dy); down.x = e.clientX; down.y = e.clientY }
        return
      }
      app.pointerMove(e.clientX - r.left, e.clientY - r.top)
      setHovering(!!app.hover)
    }
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId)
      if (touches.size < 2) pinchDist = 0
      if (!down) return
      const r = el.getBoundingClientRect()
      if (!down.moved) app.pointerClick(e.clientX - r.left, e.clientY - r.top)
      down = null; setDragging(false)
    }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); app.camera.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, -e.deltaY * 0.0018) }
    const onDbl = () => app.finishDrawing()
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') { app.draw.cancel(); app.select(null); app.clearHighlights() }
      if (e.key === 'Enter') app.finishDrawing()
      if (e.key === ' ') { e.preventDefault(); app.temporal.togglePause() }
      const step = 80
      if (e.key === 'ArrowLeft') app.camera.panByPixels(step, 0)
      if (e.key === 'ArrowRight') app.camera.panByPixels(-step, 0)
      if (e.key === 'ArrowUp') app.camera.panByPixels(0, step)
      if (e.key === 'ArrowDown') app.camera.panByPixels(0, -step)
      if (e.key === '+' || e.key === '=') app.camera.zoomAt({ x: app.camera.width / 2, y: app.camera.height / 2 }, 0.5)
      if (e.key === '-') app.camera.zoomAt({ x: app.camera.width / 2, y: app.camera.height / 2 }, -0.5)
    }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('dblclick', onDbl); window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel); el.removeEventListener('dblclick', onDbl); window.removeEventListener('keydown', onKey)
    }
  }, [app])

  const cls = ['ca-view', dragging ? 'dragging' : '', app.draw.active ? 'drawing' : '', hovering && !app.draw.active ? 'hover' : ''].join(' ')
  return <div ref={ref} className={cls} />
}
