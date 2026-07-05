import { useRef } from 'react'
import type { Keyframe } from '../types'

interface Props {
  keyframes: Keyframe[]
  width: number // content width = totalDuration * pps
  height: number
  pps: number
  totalDuration: number
  maxValue: number // top of the lane (1 = 100%; 3 = up to 3× boost for volume)
  unitLabel: string
  onBegin: () => void
  onLive: (kf: Keyframe[]) => void
  onEnd: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const PAD = 6
const COLOR = '#e0b13a'

/**
 * Editable per-track automation overlay (0..maxValue). Click to add a keyframe,
 * drag a dot to move it, double-click to remove. The top of the lane = maxValue.
 */
export default function IntensityLane({ keyframes, width, height, pps, totalDuration, maxValue, unitLabel, onBegin, onLive, onEnd }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const kf = keyframes ?? []
  const plotH = Math.max(1, height - PAD * 2)
  const y = (v: number) => PAD + (1 - clamp(v, 0, maxValue) / maxValue) * plotH
  const x = (t: number) => clamp(t, 0, totalDuration) * pps

  const sorted = [...kf].map((k, i) => ({ ...k, i })).sort((a, b) => a.t - b.t)
  const top = sorted.length
    ? `0,${y(sorted[0].v)} ` + sorted.map((k) => `${x(k.t)},${y(k.v)}`).join(' ') + ` ${width},${y(sorted[sorted.length - 1].v)}`
    : `0,${y(1)} ${width},${y(1)}`
  const fillPoints = `${top} ${width},${height} 0,${height}`

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return {
      t: clamp((e.clientX - r.left) / pps, 0, totalDuration),
      v: clamp((1 - (e.clientY - r.top - PAD) / plotH) * maxValue, 0, maxValue),
    }
  }

  function addAt(e: React.MouseEvent) {
    if (e.target !== ref.current) return // a dot was clicked, not the background
    const p = local(e)
    onBegin()
    onLive([...kf, { t: p.t, v: p.v }])
    onEnd()
  }
  function dotDown(i: number, e: React.PointerEvent) {
    e.stopPropagation()
    dragging.current = i
    onBegin()
    const move = (ev: PointerEvent) => {
      if (dragging.current == null) return
      const p = local(ev)
      onLive(kf.map((k, idx) => (idx === i ? { t: p.t, v: p.v } : k)))
    }
    const up = () => {
      dragging.current = null
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

  return (
    <svg ref={ref} className="ilane" width={width} height={height} onClick={addAt}>
      <rect x={0} y={0} width={width} height={height} fill="rgba(224,145,58,0.07)" pointerEvents="none" />
      <polygon points={fillPoints} fill="rgba(224,145,58,0.20)" pointerEvents="none" />
      <polyline points={top} fill="none" stroke={COLOR} strokeWidth={2} pointerEvents="none" />
      {!sorted.length && (
        <text x={10} y={17} fill={COLOR} fontSize={11} opacity={0.85} pointerEvents="none">
          {unitLabel} — click to add a keyframe
        </text>
      )}
      {sorted.map((k) => (
        <circle
          key={k.i}
          cx={x(k.t)}
          cy={y(k.v)}
          r={5}
          fill={COLOR}
          stroke="#14161c"
          strokeWidth={1.5}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => dotDown(k.i, e)}
          onDoubleClick={(e) => dotRemove(k.i, e)}
        />
      ))}
    </svg>
  )
}
