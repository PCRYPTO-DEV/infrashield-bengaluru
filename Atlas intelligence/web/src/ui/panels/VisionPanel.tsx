import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { CocoSsdDetector, ScriptedDetector } from '../../cv/detectors'
import { loadCocoSsdFromCdn } from '../../cv/detectors/cocoSsdCdn'
import type { Detection } from '../../cv/types'
import { PRIVACY_GUARD } from '../../cv/vision/VisionSession'
import { PALETTE } from '../../rendering/palette'
import { makeT } from '../i18n'

const W = 480, H = 270

/**
 * Camera counts: people and vehicles as moving dots, from a phone or
 * laptop camera. The panel drives one VisionSession; what it shows is the
 * Atlas Vision drawing (the city from the camera's eye, as ink lines) with
 * the tracked dots on top. The live video appears only while matching
 * points and is never stored or sent.
 */
export function VisionPanel({ app }: { app: CityAtlas }) {
  const v = app.vision
  const T = makeT(app.language)
  const STEP_NAMES = [T('cam.s1'), T('cam.s2'), T('cam.s3'), T('cam.s4')]
  const videoRef = useRef<HTMLVideoElement>(null)
  const [, force] = useState(0)
  const [pendingPx, setPendingPx] = useState<[number, number] | null>(null)
  const [demo, setDemo] = useState(false)
  useEffect(() => v.subscribe(() => force((n) => n + 1)), [v])
  useEffect(() => () => { if (v.status === 'running') v.stop() }, [v])

  const running = v.status === 'running' || v.status === 'loading'
  const step = running ? 3 : v.calibration && v.position ? 3 : v.calibration ? 2 : v.status === 'camera' || v.pairs.length > 0 || demo ? 1 : 0

  const openCamera = async () => { if (videoRef.current) await v.openCamera(videoRef.current) }

  const onVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (v.pairs.length >= 4 || running) return
    const r = e.currentTarget.getBoundingClientRect()
    const px: [number, number] = [((e.clientX - r.left) / r.width) * v.frameSize.width, ((e.clientY - r.top) / r.height) * v.frameSize.height]
    setPendingPx(px)
    app.pickMapPoint(T('cam.match.map', { n: v.pairs.length + 1 }), (_p, ll) => { v.addPair(px, ll); setPendingPx(null) })
  }
  const placeCamera = () => app.pickMapPoint(T('cam.place.hint'), (_p, ll) => v.setPosition(ll))

  const startCounting = async () => {
    const video = videoRef.current
    const detector = demo ? new ScriptedDetector(demoFrames()) : new CocoSsdDetector(() => loadCocoSsdFromCdn())
    const frames = demo ? () => DEMO_FRAME : () => (video && video.readyState >= 2 ? video : null)
    await v.run(detector, frames, (obs) => app.onVisionObservations(obs), demo ? 200 : 150)
  }
  const stop = () => { v.stop(); app.onVisionObservations([]) }

  /** Demo without a camera: a 40 × 25 m patch in front of the current map centre, a walker and a car crossing it. */
  const startDemo = () => {
    const c = app.camera.centre, upm = app.world.unitPerMetre
    const corners = [{ x: c.x - 20 * upm, y: c.y - 40 * upm }, { x: c.x + 20 * upm, y: c.y - 40 * upm }, { x: c.x + 20 * upm, y: c.y - 15 * upm }, { x: c.x - 20 * upm, y: c.y - 15 * upm }]
    v.resetPairs()
    const px: Array<[number, number]> = [[0, 0], [v.frameSize.width, 0], [v.frameSize.width, v.frameSize.height], [0, v.frameSize.height]]
    corners.forEach((p, i) => v.addPair(px[i], app.lngLatOf(p)))
    v.setPosition(app.lngLatOf({ x: c.x, y: c.y + 10 * upm }))
    setDemo(true)
  }

  const frame = v.calibration && v.position ? app.visionFrame(W, H) : null
  const dots = frame ? app.visionDots(frame) : []

  return (
    <div className="ca-panel ca-side ca-vision">
      <h3>{T('cam.title')}</h3>
      <p className="note">{T('cam.help')}</p>
      <ol className="ca-steps">{STEP_NAMES.map((n, i) => <li key={n} className={i === step ? 'now' : i < step ? 'done' : ''}>{n}</li>)}</ol>

      {step === 0 && <div className="ca-row"><button onClick={openCamera}>{T('cam.s1')}</button><button className="ghost" onClick={startDemo}>{T('cam.demo')}</button></div>}
      <video ref={videoRef} playsInline muted onClick={onVideoClick} style={{ display: v.status === 'camera' || v.status === 'calibrating' ? 'block' : 'none', width: '100%', cursor: v.pairs.length < 4 ? 'crosshair' : 'default', border: `1px solid ${PALETTE.inkHair}` }} />
      {step === 1 && !demo && <p className="note">{pendingPx ? T('cam.match.now') : T('cam.match', { n: v.pairs.length })} {v.pairs.length > 0 && <button className="small" onClick={() => v.resetPairs()}>{T('cam.startover')}</button>}</p>}
      {step === 2 && <div className="ca-row"><button onClick={placeCamera}>{T('cam.place')}</button><label className="ca-inline">{T('cam.height')} <input type="number" min={1} max={30} value={v.heightM} onChange={(e) => { v.heightM = Number(e.target.value) || 4; force((n) => n + 1) }} /> m</label></div>}
      {step === 3 && !running && <div className="ca-row"><button onClick={startCounting}>{demo ? T('cam.startdemo') : T('cam.start')}</button><button className="ghost" onClick={() => { v.resetPairs(); setDemo(false) }}>{T('cam.reset')}</button></div>}
      {v.status === 'loading' && <p className="note">{T('cam.loading')}</p>}
      {running && <div className="ca-row"><span className="ca-badge observed">{T('cam.counting', { n: v.stats.fps })}</span><button className="ghost" onClick={stop}>{T('cam.stop')}</button></div>}
      {v.error && <p className="note" style={{ color: PALETTE.risk }}>{v.error}</p>}

      {(running || v.status === 'stopped') && (
        <table><tbody>
          <tr><td>{T('cam.people')}</td><td>{v.stats.people}</td></tr>
          <tr><td>{T('cam.vehicles')}</td><td>{v.stats.vehicles}</td></tr>
          <tr><td>{T('cam.frames')}</td><td>{v.stats.frames}</td></tr>
          <tr><td>{T('cam.ms')}</td><td>{v.stats.detectMs} ms</td></tr>
        </tbody></table>
      )}

      {frame && (
        <div className="ca-visionview">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: PALETTE.paper, border: `1px solid ${PALETTE.inkHair}`, display: 'block' }}>
            <g dangerouslySetInnerHTML={{ __html: frame.svg }} />
            {dots.map((d, i) => <g key={i}><circle cx={d.x} cy={d.y} r={d.kind === 'vehicle' ? 6 : 4} fill={PALETTE.observed} /><circle cx={d.x} cy={d.y} r={11} fill="none" stroke={PALETTE.observed} strokeWidth={1} /></g>)}
          </svg>
          <p className="note">{T('cam.vision', { n: frame.paths })}</p>
        </div>
      )}
      <p className="note">{T('cam.labels', { l: PRIVACY_GUARD.labels.join(', ') })}</p>
    </div>
  )
}

const DEMO_FRAME = { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData

/** A walker crossing left to right and a car driving top to bottom, 120 frames. */
function demoFrames(): Detection[][] {
  const frames: Detection[][] = []
  for (let i = 0; i < 400; i++) {
    const t = i / 60
    const walkerX = (t * 90) % 520 - 40
    const carY = (t * 60) % 300 - 30
    const f: Detection[] = []
    if (walkerX > -40) f.push({ bbox: { x: walkerX, y: 150, w: 28, h: 70 }, label: 'person', score: 0.9 })
    f.push({ bbox: { x: 300 + Math.sin(t) * 20, y: carY, w: 70, h: 40 }, label: 'car', score: 0.85 })
    if (i % 90 > 45) f.push({ bbox: { x: 420 - ((i % 90) - 45) * 4, y: 190, w: 26, h: 64 }, label: 'person', score: 0.8 })
    frames.push(f)
  }
  return frames
}
