import type { Keyframe } from '../types'

/** Interpolate one segment a→b at time t. `a.interp` (default linear) picks the shape. */
function segEval(a: Keyframe, b: Keyframe, t: number): number {
  const u = (t - a.t) / (b.t - a.t || 1) // 0..1 within the segment
  switch (a.interp) {
    case 'hold':
      return a.v // step: holds a.v until b.t, then the next segment takes over
    case 'smooth': {
      const s = u * u * (3 - 2 * u) // smoothstep — C1-continuous, no overshoot
      return a.v + (b.v - a.v) * s
    }
    default:
      return a.v + (b.v - a.v) * u // linear
  }
}

/** Piecewise value (0..1) from keyframes (any order); 1 everywhere if none. Per-segment linear/smooth/hold. */
export function intensityAt(kf: Keyframe[] | undefined, t: number): number {
  if (!kf || !kf.length) return 1
  const s = kf.length > 1 ? [...kf].sort((a, b) => a.t - b.t) : kf
  if (t <= s[0].t) return s[0].v
  if (t >= s[s.length - 1].t) return s[s.length - 1].v
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) return segEval(s[i - 1], s[i], t)
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
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (b.t <= offset) continue // whole segment already in the past
    const tEnd = startCtx + (b.t - offset)
    if (a.interp === 'hold') {
      const tStart = startCtx + Math.max(0, a.t - offset)
      gain.setValueAtTime(base * pos(a.v), tStart)
      gain.setValueAtTime(base * pos(b.v), tEnd) // jump at the segment's end
    } else if (a.interp === 'smooth') {
      // sample the smoothstep into a value curve so playback matches the drawn shape
      const dur = b.t - a.t
      const tStart = startCtx + Math.max(0, a.t - offset)
      const span = tEnd - tStart
      if (span <= 0) {
        gain.setValueAtTime(base * pos(b.v), tEnd)
      } else {
        const n = Math.max(2, Math.min(240, Math.ceil(dur * 60)))
        const curve = new Float32Array(n)
        for (let k = 0; k < n; k++) {
          const tt = a.t + (dur * k) / (n - 1)
          curve[k] = base * pos(intensityAt(sorted, tt < offset ? offset : tt))
        }
        gain.setValueCurveAtTime(curve, tStart, span)
      }
    } else {
      gain.linearRampToValueAtTime(base * pos(b.v), tEnd)
    }
  }
}
