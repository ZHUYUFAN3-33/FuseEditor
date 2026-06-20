import { useEffect, useRef } from 'react'

interface Props {
  peaks: number[] // full-source peaks
  startFrac: number // window start as fraction of the source (0..1)
  endFrac: number // window end as fraction of the source (0..1)
  width: number
  height: number
  color: string
  ampScale: number
}

export default function WaveformCanvas({
  peaks,
  startFrac,
  endFrac,
  width,
  height,
  color,
  ampScale,
}: Props) {
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

    const n = peaks.length
    const lo = Math.max(0, Math.floor(startFrac * n))
    const hi = Math.min(n, Math.ceil(endFrac * n))
    const span = Math.max(1, hi - lo)
    const mid = height / 2
    ctx.fillStyle = color
    for (let x = 0; x < width; x++) {
      const a = lo + Math.floor((x / width) * span)
      const b = Math.max(a + 1, lo + Math.floor(((x + 1) / width) * span))
      let amp = 0
      for (let i = a; i < b && i < n; i++) if (peaks[i] > amp) amp = peaks[i]
      const h = Math.min(mid, amp * mid * ampScale)
      ctx.fillRect(x, mid - h, 1, h * 2)
    }
  }, [peaks, startFrac, endFrac, width, height, color, ampScale])

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}
