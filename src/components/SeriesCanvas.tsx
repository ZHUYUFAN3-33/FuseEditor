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
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const pad = 4
    const plotH = height - pad * 2
    const winStart = inPoint
    const winLen = duration || 1
    const hasAuto = automation != null && automation.length > 0

    csv.series.forEach((s, idx) => {
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
        const centered = (norm - 0.5) * ampScale * g + 0.5
        const y = pad + (1 - centered) * plotH
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
