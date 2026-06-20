import { useEffect, useRef } from 'react'
import type { CsvData } from '../types'

interface Props {
  csv: CsvData
  inPoint: number // window start in source seconds
  duration: number // window length in seconds
  width: number
  height: number
  ampScale: number
}

const LINE_COLORS = ['#e0913a', '#4f7cff', '#2dbd8f', '#d65db1', '#ff6b6b', '#54c7ec']

export default function SeriesCanvas({ csv, inPoint, duration, width, height, ampScale }: Props) {
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
        const centered = (norm - 0.5) * ampScale + 0.5
        const y = pad + (1 - centered) * plotH
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }, [csv, inPoint, duration, width, height, ampScale])

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}
