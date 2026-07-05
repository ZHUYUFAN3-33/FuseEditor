import type { Clip } from '../types'

const EPS = 1e-6

/**
 * Find a non-overlapping start for a clip of length `dur` on a track, as close as
 * possible to `desired`. `others` are the clips already on that track. Snaps to just
 * before or just after a neighbour (whichever is nearer), guaranteeing no overlap.
 */
export function resolveStart(others: Clip[], desired: number, dur: number): number {
  const d = Math.max(0, desired)
  const sorted = [...others].sort((a, b) => a.start - b.start)
  const overlaps = (s: number) => sorted.some((c) => s < c.start + c.duration - EPS && s + dur > c.start + EPS)
  if (!overlaps(d)) return d

  const candidates: number[] = []
  for (const c of sorted) {
    candidates.push(c.start + c.duration) // butt up right after this clip
    candidates.push(c.start - dur) // butt up right before it
  }
  const valid = candidates.map((s) => Math.max(0, s)).filter((s) => !overlaps(s))
  if (!valid.length) return sorted.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  valid.sort((a, b) => Math.abs(a - d) - Math.abs(b - d))
  return valid[0]
}
