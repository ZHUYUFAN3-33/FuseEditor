import { useEffect, useRef } from 'react'
import { intensityAt } from '../lib/automation'
import type { CsvData, Keyframe } from '../types'

interface Props {
  csv: CsvData
  inPoint: number // window start in source seconds
  duration: number // window length in seconds
  width: number
  height: number
  ampScale: number
  automation?: Keyframe[] // intensity curve to visualise (per-track)
  clipStart: number // clip's timeline start (s)
}

const LINE_COLORS = ['#e0913a', '#4f7cff', '#2dbd8f', '#d65db1', '#ff6b6b', '#54c7ec']

export default function SeriesCanvas({ csv, inPoint, duration, width, height, ampScale, automation, clipStart }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width <= 0 || height <= 0) return
    // A constant carrier (e.g. all-ones) draws nothing — keep the canvas tiny so it costs nothing
    // to re-run this effect on every envelope-drag frame (no 8192px realloc = no drag stall).
    if (!csv.series.some((s) => s.max - s.min >= 1e-9)) {
      canvas.width = 1
      canvas.height = 1
      return
    }
    const dpr = window.devicePixelRatio || 1
    // cap the backing store well under the GPU limit — a too-large texture renders blank/black
    const MAX = 8192
    const bw = Math.min(Math.max(1, Math.floor(width * dpr)), MAX)
    const bh = Math.min(Math.max(1, Math.floor(height * dpr)), MAX)
    canvas.width = bw
    canvas.height = bh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(bw / width, 0, 0, bh / height, 0, 0) // x-scale drops below dpr at extreme zoom
    ctx.clearRect(0, 0, width, height)

    const pad = 4
    const plotH = height - pad * 2
    const winStart = inPoint
    const winLen = duration || 1
    const hasAuto = automation != null && automation.length > 0

    csv.series.forEach((s, idx) => {
      // Constant channel (e.g. an all-ones carrier): its "waveform" carries no info and,
      // scaled by the envelope, would draw an inverted line that reads backwards. Skip it —
      // the intensity lane above is the real preview.
      if (s.max - s.min < 1e-9) return
      ctx.strokeStyle = LINE_COLORS[idx % LINE_COLORS.length]
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const range = s.max - s.min || 1
      let started = false
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i]
        if (p.t < winStart || p.t > winStart + winLen) continue
        const x = ((p.t - winStart) / winLen) * width
        const norm = (p.v - s.min) / range
        // scale amplitude by the intensity automation at this point (live feedback)
        const g = hasAuto ? intensityAt(automation, clipStart + (p.t - winStart)) : 1
        // FMG force is unipolar: 0 (no force) sits at the BOTTOM, 1 (max) at the top, so height =
        // force. Amplitude scales UP from the baseline (not around the middle like an audio wave).
        const scaled = Math.max(0, Math.min(1, norm * ampScale * g))
        const y = pad + (1 - scaled) * plotH
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }, [csv, inPoint, duration, width, height, ampScale, automation, clipStart])

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}
