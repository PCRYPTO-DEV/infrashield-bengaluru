import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { BestDetector } from '../../cv/detectors/mediapipe'
import { PRIVACY_GUARD } from '../../cv/vision/VisionSession'
import { PALETTE } from '../../rendering/palette'
import { makeT } from '../i18n'

const W = 480, H = 270

/**
 * Atlas Vision: people and vehicles counted as moving dots from a phone or
 * laptop camera. Open the camera, place it on the map (quick: where it
 * stands and where it looks; exact: four matched points), count. The live
 * picture with its boxes is shown on this device only; nothing is stored or
 * sent, and no face model exists in the app.
 */
export function VisionPanel({ app }: { app: CityAtlas }) {
  const v = app.vision
  const T = makeT(app.language)
  const STEP_NAMES = [T('cam.s1'), T('cam.s3'), T('cam.s4')]
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [, force] = useState(0)
  const [pendingPx, setPendingPx] = useState<[number, number] | null>(null)
  const [exact, setExact] = useState(false)
  useEffect(() => v.subscribe(() => force((n) => n + 1)), [v])
  // Closing the panel releases the camera: the light goes off.
  useEffect(() => () => { v.close(); app.onVisionObservations([]) }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  // The video element must keep the stream when React re-renders.
  useEffect(() => { if (videoRef.current && v.cameraOpen && !videoRef.current.srcObject) void v.attach(videoRef.current) })

  const running = v.status === 'running' || v.status === 'loading'
  const placed = !!v.calibration
  const step = running ? 2 : placed ? 2 : v.cameraOpen ? 1 : 0

  const openCamera = async () => { if (videoRef.current) await v.openCamera(videoRef.current) }
  const onVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!exact || v.pairs.length >= 4 || running) return
    const r = e.currentTarget.getBoundingClientRect()
    const px: [number, number] = [((e.clientX - r.left) / r.width) * v.frameSize.width, ((e.clientY - r.top) / r.height) * v.frameSize.height]
    setPendingPx(px)
    app.pickMapPoint(T('cam.match.map', { n: v.pairs.length + 1 }), (_p, ll) => { v.addPair(px, ll); setPendingPx(null) })
  }
  const pickStand = () => app.pickMapPoint(T('cam.stand.hint'), (_p, ll) => { if (v.lookAt) v.quickPlace(ll, v.lookAt); else v.setPosition(ll) })
  const pickLook = () => app.pickMapPoint(T('cam.look.hint'), (_p, ll) => { if (v.position) v.quickPlace(v.position, ll); else { v.lookAt = ll; force((n) => n + 1) } })
  const startCounting = async () => {
    const video = videoRef.current
    await v.run(new BestDetector(), () => (video && video.readyState >= 2 ? video : null), (obs) => app.onVisionObservations(obs), 120)
  }
  const stop = () => { v.stop(); app.onVisionObservations([]) }
  const off = () => { v.close(); app.onVisionObservations([]) }

  // Boxes over the live picture, drawn on this device only.
  useEffect(() => {
    const c = overlayRef.current, video = videoRef.current
    if (!c || !video || !running) return
    const w = v.frameSize.width, h = v.frameSize.height
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    for (const d of v.lastDetections) {
      const car = d.label !== 'person'
      ctx.strokeStyle = car ? '#0F6FFF' : '#7ED957'; ctx.lineWidth = 3
      ctx.strokeRect(d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h)
      ctx.fillStyle = car ? '#0F6FFF' : '#7ED957'
      ctx.beginPath(); ctx.arc(d.bbox.x + d.bbox.w / 2, d.bbox.y + d.bbox.h, 6, 0, Math.PI * 2); ctx.fill()
      ctx.font = '600 16px DM Sans, Arial, sans-serif'; ctx.fillText(`${d.label} ${Math.round(d.score * 100)}%`, d.bbox.x + 4, Math.max(16, d.bbox.y - 6))
    }
  })

  const frame = v.calibration && v.position ? app.visionFrame(W, H) : null
  const dots = frame ? app.visionDots(frame) : []
  const showVideo = v.cameraOpen && (v.status === 'camera' || v.status === 'calibrating' || running)
  const errorText = v.error ? (/NotAllowed|Permission|denied/i.test(v.error) ? T('cam.err.denied') : /NotFound|no camera|Requested device/i.test(v.error) ? T('cam.err.none') : v.error) : null

  return (
    <div className="ca-panel ca-side ca-vision">
      <h3>{T('cam.title')} {v.cameraOpen && <button className="small" onClick={off}>{T('cam.off')}</button>}</h3>
      <p className="note">{T('cam.help')}</p>
      <ol className="ca-steps">{STEP_NAMES.map((n, i) => <li key={n} className={i === step ? 'now' : i < step ? 'done' : ''}>{n}</li>)}</ol>

      {step === 0 && <div className="ca-row"><button onClick={openCamera}>{T('cam.s1')}</button></div>}
      <div className="ca-videowrap" style={{ display: showVideo ? 'block' : 'none' }}>
        <video ref={videoRef} playsInline muted onClick={onVideoClick} style={{ width: '100%', display: 'block', cursor: exact && v.pairs.length < 4 ? 'crosshair' : 'default', borderRadius: 9 }} />
        <canvas ref={overlayRef} className="ca-videoboxes" style={{ display: running ? 'block' : 'none' }} />
      </div>
      {running && <p className="note">{T('cam.live')}</p>}

      {v.cameraOpen && !running && !exact && <>
        <p className="note"><b>{T('cam.quick')}</b> · {T('cam.quick.help')}</p>
        <div className="ca-row">
          <button className={v.position ? 'ghost' : ''} onClick={pickStand}>{v.position ? '✓ ' : ''}{T('cam.stand')}</button>
          <button className={v.lookAt ? 'ghost' : ''} onClick={pickLook}>{v.lookAt ? '✓ ' : ''}{T('cam.look')}</button>
          <label className="ca-inline">{T('cam.height')} <input type="number" min={1} max={40} value={v.heightM} onChange={(e) => v.setHeight(Number(e.target.value) || 4)} /> m</label>
        </div>
        <button className="small" onClick={() => { setExact(true); v.resetPairs() }}>{T('cam.points')}</button>
      </>}
      {v.cameraOpen && !running && exact && <>
        <p className="note">{pendingPx ? T('cam.match.now') : T('cam.match', { n: v.pairs.length })} {v.pairs.length > 0 && <button className="small" onClick={() => v.resetPairs()}>{T('cam.startover')}</button>} <button className="small" onClick={() => { setExact(false); v.resetPairs() }}>{T('cam.quick')}</button></p>
        {v.pairs.length >= 4 && <div className="ca-row"><button onClick={() => app.pickMapPoint(T('cam.place.hint'), (_p, ll) => v.setPosition(ll))}>{T('cam.place')}</button><label className="ca-inline">{T('cam.height')} <input type="number" min={1} max={40} value={v.heightM} onChange={(e) => v.setHeight(Number(e.target.value) || 4)} /> m</label></div>}
      </>}
      {placed && !running && <div className="ca-row"><button onClick={startCounting}>{T('cam.start')}</button><span className="note">{v.calibrationMode === 'quick' ? T('cam.quickmode') : T('cam.pointsmode')}</span></div>}
      {v.status === 'loading' && <p className="note">{T('cam.loading')}</p>}
      {running && <div className="ca-row"><span className="ca-badge observed">{T('cam.counting', { n: v.stats.fps })}</span>{v.detectorId && <span className="note">{T('cam.detector')}: {v.detectorId}</span>}<button className="ghost" onClick={stop}>{T('cam.stop')}</button></div>}
      {errorText && <p className="note" style={{ color: 'var(--risk)' }}>{errorText}</p>}

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
