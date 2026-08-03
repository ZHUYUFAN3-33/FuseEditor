import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Diamond, Eraser, Magnet, Pencil, Trash2, Waves, X } from 'lucide-react'
import type { Clip, Interp, Keyframe, MediaSource, Track } from '../types'
import SeriesCanvas from './SeriesCanvas'
import IntensityLane, { type LaneMode } from './IntensityLane'
import { PRESETS, type PresetId } from '../lib/envelope'
import { fmtTime } from '../lib/format'

interface Props {
  track: Track
  clips: Clip[] // this track's clips (for the faint data reference)
  sourcesById: Record<string, MediaSource>
  totalDuration: number
  maxValue: number
  neutral: number
  unitLabel: string
  mode: LaneMode
  setMode: (m: LaneMode) => void
  interp: Interp
  setInterp: (i: Interp) => void
  snap: boolean
  setSnap: (b: boolean) => void
  armedPreset: PresetId | null
  setArmedPreset: (p: PresetId | null) => void
  onSetIntensity: (kf: Keyframe[]) => void
  beginGesture: () => void
  endGesture: () => void
  onClear: () => void
  onClose: () => void
}

export default function EnvelopeFocus({
  track,
  clips,
  sourcesById,
  totalDuration,
  maxValue,
  neutral,
  unitLabel,
  mode,
  setMode,
  interp,
  setInterp,
  snap,
  setSnap,
  armedPreset,
  setArmedPreset,
  onSetIntensity,
  beginGesture,
  endGesture,
  onClear,
  onClose,
}: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 900, h: 420 })

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pps = Math.max(1, dims.w / Math.max(1, totalDuration))
  const csvClips = clips.filter((c) => sourcesById[c.sourceId]?.csv)
  const step = niceStep(totalDuration)
  const marks: number[] = []
  for (let s = 0; s <= totalDuration + 1e-6; s += step) marks.push(s)

  return (
    <div className="envfocus">
      <div className="envfocus__bar">
        <span className="envfocus__title">
          <Diamond size={13} fill="currentColor" style={{ verticalAlign: '-1px' }} /> Envelope — {track.name}
        </span>
        <div className="toolgroup">
          {([
            ['point', <><Pencil size={13} /> Point</>],
            ['pencil', <><Waves size={13} /> Draw</>],
            ['erase', <><Eraser size={13} /> Erase</>],
          ] as [LaneMode, ReactNode][]).map(([m, label]) => (
            <button key={m} className={'tool' + (mode === m ? ' tool--on' : '')} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="toolgroup" title="Curve of new points (right-click a point to change it)">
          {([
            ['linear', 'Lin'],
            ['smooth', 'Curve'],
            ['hold', 'Hold'],
          ] as [Interp, string][]).map(([it, label]) => (
            <button key={it} className={'tool' + (interp === it ? ' tool--on' : '')} onClick={() => setInterp(it)}>
              {label}
            </button>
          ))}
        </div>
        <button className={'tool' + (snap ? ' tool--on' : '')} onClick={() => setSnap(!snap)}>
          <Magnet size={13} /> Snap
        </button>
        <button className="tool" onClick={onClear}>
          <Trash2 size={13} /> Clear
        </button>
        <div className="envfocus__spacer" />
        <span className="envfocus__stamp">Stamp:</span>
        <div className="toolgroup">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={'tool' + (armedPreset === p.id ? ' tool--armed' : '')}
              title={`Arm "${p.label}" — then click the canvas to place it`}
              onClick={() => setArmedPreset(armedPreset === p.id ? null : (p.id as PresetId))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button className="tool envfocus__close" title="Close (Esc)" onClick={onClose}>
          <X size={14} /> Done
        </button>
      </div>

      <div className="envfocus__ruler">
        {marks.map((s) => (
          <span key={s} className="envfocus__mark" style={{ left: s * pps }}>
            {fmtTime(s, false)}
          </span>
        ))}
      </div>

      <div className="envfocus__area" ref={areaRef}>
        {/* faint raw data as a drawing reference */}
        {csvClips.map((c) => {
          const src = sourcesById[c.sourceId]!
          return (
            <div
              key={c.id}
              className="envfocus__data"
              style={{ left: c.start * pps, width: Math.max(2, c.duration * pps), height: dims.h }}
            >
              <SeriesCanvas
                csv={src.csv!}
                inPoint={c.inPoint}
                duration={c.duration}
                width={Math.max(2, c.duration * pps)}
                height={dims.h}
                ampScale={1}
                clipStart={c.start}
              />
            </div>
          )
        })}
        {/* the envelope — the whole timeline fits, so viewLeft is 0 */}
        {dims.w > 0 && (
          <IntensityLane
            keyframes={track.intensity ?? []}
            viewLeft={0}
            viewWidth={dims.w}
            height={dims.h}
            pps={pps}
            totalDuration={totalDuration}
            maxValue={maxValue}
            neutral={neutral}
            unitLabel={unitLabel}
            mode={mode}
            defaultInterp={interp}
            snap={snap}
            armedPreset={armedPreset}
            onConsumePreset={() => setArmedPreset(null)}
            onBegin={beginGesture}
            onLive={onSetIntensity}
            onEnd={endGesture}
          />
        )}
      </div>
    </div>
  )
}

function niceStep(dur: number): number {
  const target = dur / 10
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) if (s >= target) return s
  return 600
}
