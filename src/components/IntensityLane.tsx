import { useRef, useState } from 'react'
import type { Keyframe, Interp } from '../types'
import { simplifyKeyframes, mergeOnDrop, PRESETS, cyclInterp, type PresetId } from '../lib/envelope'

export type LaneMode = 'point' | 'pencil' | 'erase'

interface Props {
  keyframes: Keyframe[]
  viewLeft: number // scroll offset in px (lane coords) — the curve is drawn from here
  viewWidth: number // visible lane width in px (SVG only spans this — never the whole timeline)
  height: number
  pps: number
  totalDuration: number
  maxValue: number // top of the lane (1 = 100%; 3 = up to 3× boost for volume)
  neutral: number // reference midline (csv: 0.5 rest; audio: 1.0 unity)
  unitLabel: string
  mode: LaneMode
  defaultInterp: Interp
  snap: boolean
  armedPreset: PresetId | null
  onConsumePreset: () => void
  onBegin: () => void
  onLive: (kf: Keyframe[]) => void
  onEnd: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const PAD = 6
const COLOR = '#f5871f' // envelope curve — warm orange, reads on both light & dark backgrounds
const SNAP_T = 0.1 // seconds
const SNAP_V = 0.05

export default function IntensityLane({
  keyframes,
  viewLeft,
  viewWidth,
  height,
  pps,
  totalDuration,
  maxValue,
  neutral,
  unitLabel,
  mode,
  defaultInterp,
  snap,
  armedPreset,
  onConsumePreset,
  onBegin,
  onLive,
  onEnd,
}: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [readout, setReadout] = useState<{ t: number; v: number } | null>(null)
  const [stroke, setStroke] = useState<Keyframe[] | null>(null) // live freehand preview

  const kf = keyframes ?? []
  const plotH = Math.max(1, height - PAD * 2)
  const y = (v: number) => PAD + (1 - clamp(v, 0, maxValue) / maxValue) * plotH
  const x = (t: number) => t * pps - viewLeft // local x within the (viewport-sized) SVG

  const sorted = [...kf].map((k, i) => ({ ...k, i })).sort((a, b) => a.t - b.t)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    let t = clamp((viewLeft + (e.clientX - r.left)) / pps, 0, totalDuration)
    let v = clamp((1 - (e.clientY - r.top - PAD) / plotH) * maxValue, 0, maxValue)
    if (snap) {
      t = Math.round(t / SNAP_T) * SNAP_T
      v = Math.round(v / SNAP_V) * SNAP_V
    }
    return { t, v }
  }

  // piecewise sampler over the pre-sorted keyframes — SAME shape as automation.intensityAt (export truth)
  const curveVal = (t: number): number => {
    const s = sorted
    if (!s.length) return 1
    if (t <= s[0].t) return s[0].v
    if (t >= s[s.length - 1].t) return s[s.length - 1].v
    for (let i = 1; i < s.length; i++) {
      if (s[i].t >= t) {
        const a = s[i - 1]
        const b = s[i]
        const u = (t - a.t) / (b.t - a.t || 1)
        if (a.interp === 'hold') return a.v
        if (a.interp === 'smooth') return a.v + (b.v - a.v) * (u * u * (3 - 2 * u))
        return a.v + (b.v - a.v) * u
      }
    }
    return 1
  }

  // ---- build the curve ONLY across the visible window [viewLeft, viewLeft+viewWidth] ----
  const t0 = viewLeft / pps
  const t1 = (viewLeft + viewWidth) / pps
  const times: number[] = []
  const N = Math.min(1600, Math.max(2, Math.ceil(viewWidth / 3)))
  for (let i = 0; i <= N; i++) times.push(t0 + ((t1 - t0) * i) / N)
  for (const k of sorted) if (k.t > t0 && k.t < t1) times.push(k.t, k.t + 1e-6) // sharp corners / hold steps
  times.sort((a, b) => a - b)
  const curve = times.map((t) => [clamp(x(t), 0, viewWidth), y(curveVal(t))] as [number, number])
  const linePts = curve.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const fillPts = `${linePts} ${viewWidth},${height} 0,${height}`

  // only the keyframes whose dot is on-screen get rendered (bounded work regardless of zoom)
  const visible = sorted.filter((k) => x(k.t) >= -14 && x(k.t) <= viewWidth + 14)

  const gridVals = [0.25, 0.5, 0.75].map((f) => f * maxValue)

  // ---- gesture helpers ----
  const stampPreset = (id: PresetId, t: number) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    onBegin()
    onLive(mergeOnDrop(kf, preset.make(t)))
    onEnd()
    onConsumePreset()
  }

  function bgDown(e: React.PointerEvent) {
    if (e.target !== ref.current) return // a dot was hit
    e.preventDefault()
    const p = local(e)
    setSelected(null)

    if (armedPreset) {
      stampPreset(armedPreset, p.t)
      return
    }

    if (mode === 'pencil') {
      onBegin()
      const raw: Keyframe[] = [{ t: p.t, v: p.v }]
      setStroke(raw)
      const move = (ev: PointerEvent) => {
        const q = local(ev)
        const last = raw[raw.length - 1]
        if (Math.abs(q.t - last.t) < 1e-4) raw[raw.length - 1] = q
        else raw.push(q)
        setStroke([...raw])
        setReadout(q)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        setStroke(null)
        setReadout(null)
        const simplified = simplifyKeyframes([...raw].sort((a, b) => a.t - b.t).map((k) => ({ t: k.t, v: k.v })))
        onLive(mergeOnDrop(kf, simplified))
        onEnd()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up, { once: true })
      return
    }

    if (mode === 'erase') {
      onBegin()
      let cur = kf
      const removeNear = (ev: PointerEvent) => {
        const cx = ev.clientX - ref.current!.getBoundingClientRect().left
        const next = cur.filter((k) => Math.abs(x(k.t) - cx) > 11)
        if (next.length !== cur.length) {
          cur = next
          onLive(cur)
        }
      }
      removeNear(e.nativeEvent)
      const up = () => {
        window.removeEventListener('pointermove', removeNear)
        onEnd()
      }
      window.addEventListener('pointermove', removeNear)
      window.addEventListener('pointerup', up, { once: true })
      return
    }

    // point mode: add a keyframe with the default interpolation
    onBegin()
    onLive([...kf, { t: p.t, v: p.v, ...(defaultInterp !== 'linear' ? { interp: defaultInterp } : {}) }])
    onEnd()
  }

  function dotDown(i: number, e: React.PointerEvent) {
    e.stopPropagation()
    if (mode === 'erase') {
      onBegin()
      onLive(kf.filter((_, idx) => idx !== i))
      onEnd()
      return
    }
    setSelected(i)
    dragging.current = i
    onBegin()
    const move = (ev: PointerEvent) => {
      if (dragging.current == null) return
      const p = local(ev)
      setReadout(p)
      onLive(kf.map((k, idx) => (idx === i ? { ...k, t: p.t, v: p.v } : k)))
    }
    const up = () => {
      dragging.current = null
      setReadout(null)
      window.removeEventListener('pointermove', move)
      onEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  function dotRemove(i: number, e: React.MouseEvent) {
    e.stopPropagation()
    onBegin()
    onLive(kf.filter((_, idx) => idx !== i))
    onEnd()
  }

  function cycleInterp(i: number, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onBegin()
    onLive(kf.map((k, idx) => (idx === i ? { ...k, interp: cyclInterp(k.interp) } : k)))
    onEnd()
  }

  const interpBadge = (k: Interp | undefined) => (k === 'smooth' ? 'S' : k === 'hold' ? 'H' : 'L')

  return (
    <svg
      ref={ref}
      className={'ilane ilane--' + mode + (armedPreset ? ' ilane--armed' : '')}
      width={viewWidth}
      height={height}
      style={{ left: viewLeft }}
      onPointerDown={bgDown}
      onPointerMove={(e) => {
        if (dragging.current == null && !stroke) setReadout(local(e))
      }}
      onPointerLeave={() => !dragging.current && !stroke && setReadout(null)}
    >
      <rect x={0} y={0} width={viewWidth} height={height} fill="rgba(224,145,58,0.06)" pointerEvents="none" />
      {gridVals.map((gv, idx) => (
        <line
          key={idx}
          x1={0}
          x2={viewWidth}
          y1={y(gv)}
          y2={y(gv)}
          stroke={Math.abs(gv - neutral) < 1e-6 ? 'rgba(224,145,58,0.5)' : 'rgba(255,255,255,0.08)'}
          strokeWidth={1}
          strokeDasharray={Math.abs(gv - neutral) < 1e-6 ? '5 4' : '2 4'}
          pointerEvents="none"
        />
      ))}
      <polygon points={fillPts} fill="rgba(224,145,58,0.18)" pointerEvents="none" />
      <polyline points={linePts} fill="none" stroke={COLOR} strokeWidth={2} pointerEvents="none" />
      {stroke && (
        <polyline
          points={stroke.map((k) => `${x(k.t)},${y(k.v)}`).join(' ')}
          fill="none"
          stroke="#fff"
          strokeWidth={1.5}
          strokeOpacity={0.85}
          pointerEvents="none"
        />
      )}
      {!sorted.length && !stroke && (
        <text x={10} y={height - 8} fill={COLOR} fontSize={11} opacity={0.8} pointerEvents="none">
          {unitLabel} — click to add · drag to move · click a point then delete · Erase sweeps · Clear resets
        </text>
      )}
      {mode === 'point' &&
        visible.map((k) => (
          <g key={k.i}>
            <circle
              cx={x(k.t)}
              cy={y(k.v)}
              r={selected === k.i ? 13 : 8}
              fill="transparent"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => dotDown(k.i, e)}
              onDoubleClick={(e) => dotRemove(k.i, e)}
              onContextMenu={(e) => cycleInterp(k.i, e)}
            />
            <circle
              cx={x(k.t)}
              cy={y(k.v)}
              r={selected === k.i ? 6 : 5}
              fill={selected === k.i ? '#fff' : COLOR}
              stroke="#14161c"
              strokeWidth={1.5}
              pointerEvents="none"
            />
            {k.interp && k.interp !== 'linear' && (
              <text x={x(k.t) + 7} y={y(k.v) - 6} fill={COLOR} fontSize={9} pointerEvents="none">
                {interpBadge(k.interp)}
              </text>
            )}
            {selected === k.i && (
              <g style={{ cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => dotRemove(k.i, e)}>
                <circle cx={x(k.t)} cy={y(k.v) - 18 < 9 ? y(k.v) + 18 : y(k.v) - 18} r={8} fill="#ff6b6b" stroke="#14161c" strokeWidth={1.5} />
                <text
                  x={x(k.t)}
                  y={(y(k.v) - 18 < 9 ? y(k.v) + 18 : y(k.v) - 18) + 4}
                  fill="#fff"
                  fontSize={12}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  ×
                </text>
              </g>
            )}
          </g>
        ))}
      {mode === 'erase' &&
        visible.map((k) => (
          <g key={k.i}>
            <circle cx={x(k.t)} cy={y(k.v)} r={13} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={(e) => dotDown(k.i, e)} />
            <circle cx={x(k.t)} cy={y(k.v)} r={5} fill="#ff6b6b" stroke="#14161c" strokeWidth={1.5} pointerEvents="none" />
          </g>
        ))}
      {readout && (
        <text x={clamp(x(readout.t) + 8, 0, viewWidth - 90)} y={16} fill="#fff" fontSize={11} pointerEvents="none">
          {readout.t.toFixed(2)}s · {maxValue > 1 ? readout.v.toFixed(2) + '×' : Math.round(readout.v * 100) + '%'}
        </text>
      )}
    </svg>
  )
}
