import type { Keyframe, Interp } from '../types'

// ---------- freehand: reduce a dense pointer stroke to a few keyframes ----------

/**
 * Ramer–Douglas–Peucker on the (t, v) polyline. Axes are normalized (t by the
 * stroke span, v is already 0..1) so `eps` is scale-free. Endpoints always kept.
 */
export function simplifyKeyframes(points: Keyframe[], eps = 0.015, cap = 48): Keyframe[] {
  if (points.length <= 2) return points.slice()
  const t0 = points[0].t
  const span = points[points.length - 1].t - t0 || 1
  const nt = (t: number) => (t - t0) / span // normalized t

  const rdp = (lo: number, hi: number, out: boolean[]) => {
    const ax = nt(points[lo].t)
    const ay = points[lo].v
    const bx = nt(points[hi].t)
    const by = points[hi].v
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    let maxD = -1
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const px = nt(points[i].t)
      const py = points[i].v
      // perpendicular distance from point to line a→b
      const cross = Math.abs((px - ax) * dy - (py - ay) * dx)
      const d = cross / Math.sqrt(len2)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps && idx > lo) {
      rdp(lo, idx, out)
      rdp(idx, hi, out)
    } else {
      out[lo] = true
      out[hi] = true
    }
  }

  const keep: boolean[] = new Array(points.length).fill(false)
  rdp(0, points.length - 1, keep)
  let kept = points.filter((_, i) => keep[i])
  // hard cap: if RDP still returns too many, keep evenly-spaced samples
  if (kept.length > cap) {
    const step = kept.length / cap
    const thinned: Keyframe[] = []
    for (let i = 0; i < cap; i++) thinned.push(kept[Math.floor(i * step)])
    thinned[thinned.length - 1] = kept[kept.length - 1]
    kept = thinned
  }
  return kept
}

// ---------- merge a generated/drawn segment into an existing curve ----------

/** Drop existing keyframes inside [t0,t1] and splice `insert` in; returns a sorted curve. */
export function mergeOnDrop(existing: Keyframe[], insert: Keyframe[]): Keyframe[] {
  if (!insert.length) return existing
  const t0 = insert[0].t
  const t1 = insert[insert.length - 1].t
  const kept = existing.filter((k) => k.t < t0 - 1e-6 || k.t > t1 + 1e-6)
  return [...kept, ...insert].sort((a, b) => a.t - b.t)
}

// ---------- preset "stamps": muscle-activity shapes anchored at a click time ----------

export type PresetId = 'rampUp' | 'rampDown' | 'burst' | 'pulse' | 'plateau'

export interface Preset {
  id: PresetId
  label: string
  span: number // default width in seconds
  make: (t0: number) => Keyframe[]
}

const kf = (t: number, v: number, interp?: Interp): Keyframe => (interp ? { t, v, interp } : { t, v })

/** All presets rest at 0.5 (neutral) and peak at 1.0, with muscle-like attack/release. */
export const PRESETS: Preset[] = [
  {
    id: 'burst',
    label: 'Burst',
    span: 0.5,
    // fast smooth attack, brief hold, slower smooth release — like an EMG/FMG contraction
    make: (t0) => [kf(t0, 0.5, 'smooth'), kf(t0 + 0.12, 1.0, 'hold'), kf(t0 + 0.22, 1.0, 'smooth'), kf(t0 + 0.5, 0.5)],
  },
  {
    id: 'pulse',
    label: 'Pulse',
    span: 0.16,
    // quick symmetric twitch — LINEAR up/down so the peak is a sharp point, not a round dome
    make: (t0) => [kf(t0, 0.5), kf(t0 + 0.08, 1.0), kf(t0 + 0.16, 0.5)],
  },
  {
    id: 'plateau',
    label: 'Plateau',
    span: 1.0,
    make: (t0) => [kf(t0, 0.5, 'smooth'), kf(t0 + 0.12, 1.0, 'hold'), kf(t0 + 0.88, 1.0, 'smooth'), kf(t0 + 1.0, 0.5)],
  },
  {
    id: 'rampUp',
    label: 'Ramp ↑',
    span: 1.0,
    make: (t0) => [kf(t0, 0.0), kf(t0 + 1.0, 1.0)],
  },
  {
    id: 'rampDown',
    label: 'Ramp ↓',
    span: 1.0,
    make: (t0) => [kf(t0, 1.0), kf(t0 + 1.0, 0.0)],
  },
]

export const cyclInterp = (i: Interp | undefined): Interp =>
  i === 'smooth' ? 'hold' : i === 'hold' ? 'linear' : 'smooth'
