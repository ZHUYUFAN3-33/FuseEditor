import type { Keyframe } from '../types'

/** Piecewise-linear value (0..1) from keyframes (any order); 1 everywhere if none. */
export function intensityAt(kf: Keyframe[] | undefined, t: number): number {
  if (!kf || !kf.length) return 1
  const s = kf.length > 1 ? [...kf].sort((a, b) => a.t - b.t) : kf
  if (t <= s[0].t) return s[0].v
  if (t >= s[s.length - 1].t) return s[s.length - 1].v
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const a = s[i - 1]
      const b = s[i]
      return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t || 1))
    }
  }
  return 1
}

/**
 * Schedule a Web Audio gain node to follow `base × keyframe curve` over time.
 * `offset` maps timeline time → context time: ctxTime = startCtx + (kf.t - offset).
 * With offset=0 and startCtx=0 it's an absolute schedule (offline render).
 */
export function scheduleGain(gain: AudioParam, kf: Keyframe[] | undefined, base: number, startCtx: number, offset: number) {
  gain.cancelScheduledValues(startCtx)
  if (!kf || !kf.length) {
    gain.setValueAtTime(base, startCtx)
    return
  }
  const sorted = [...kf].sort((a, b) => a.t - b.t)
  const pos = (v: number) => Math.max(0, v) // allow boost above 1× (2×, 3×…); only clamp negatives
  gain.setValueAtTime(base * pos(intensityAt(sorted, offset)), startCtx)
  for (const k of sorted) {
    if (k.t <= offset) continue
    gain.linearRampToValueAtTime(base * pos(k.v), startCtx + (k.t - offset))
  }
}
