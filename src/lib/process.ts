import type { CsvData, Series } from '../types'

// ===== Hardcoded processing parameters — FIXED, ported 1:1 from Data_Process&Save.py.
// Do not parameterize or "tune" these; the user relies on them being exact. =====
export const PROCESS_PARAMS = {
  FMG_TARGET_RATE: 60.0, // Hz
  SG_WINDOW: 9, // Savitzky–Golay window (must be odd)
  SG_POLY: 3, // Savitzky–Golay polyorder
} as const

export class CsvFormatError extends Error {}

/** Result of processing one raw FMG CSV. */
export interface ProcessResult {
  csvText: string // processed CSV text ([timestamp, chan1..N], 60 Hz, normalized+smoothed)
  data: CsvData // parsed for the editor
  rows: number
  channels: number
}

// ---------- raw parsing + alignment (load_and_align) ----------

interface RawTable {
  timeSeconds: number[] // timestamp relative to first row, in seconds
  channelNames: string[]
  channels: number[][] // [channel][row]
}

function splitRow(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

/**
 * Port of load_and_align: detect the [t_mono, timestamp, chan1..16] format
 * (or the old [timestamp, chan1..16] format) and align timestamps to start at 0.
 * Throws CsvFormatError on anything that doesn't match.
 */
function loadAndAlign(text: string): RawTable {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  if (lines.length < 2) throw new CsvFormatError('格式有問題:檔案沒有資料列')

  const header = splitRow(lines[0])
  let channelStartIdx: number
  let channelNames: string[]
  let timeOf: (cells: string[]) => number
  let timeLabel: string

  if (header[0] === 't_mono') {
    // [t_mono, timestamp, chan1..16]. Match the Python pipeline: use the datetime
    // `timestamp` (col 1) as the time axis via datetimeToSeconds (full sub-second
    // precision — NOT JS Date, which is ms-only and collapses microsecond samples).
    // Fall back to the numeric t_mono (col 0) if the timestamp doesn't parse.
    if (header.length < 3) throw new CsvFormatError('格式有問題:t_mono 格式至少要有 t_mono、timestamp 和一個 channel 欄位')
    channelStartIdx = 2
    channelNames = header.slice(2).map((_, i) => `chan${i + 1}`)
    const probe = lines.length > 1 ? datetimeToSeconds(splitRow(lines[1])[1]) : NaN
    if (isFinite(probe)) {
      timeOf = (cells) => datetimeToSeconds(cells[1])
      timeLabel = 'timestamp'
    } else {
      timeOf = (cells) => parseFloat(cells[0])
      timeLabel = 't_mono'
    }
  } else if (header.includes('timestamp')) {
    // old format: [timestamp, chan1..16] — parse the datetime with full sub-second precision.
    const tsIdx = header.indexOf('timestamp')
    channelStartIdx = tsIdx + 1
    channelNames = header.slice(channelStartIdx)
    if (!channelNames.length) throw new CsvFormatError('格式有問題:timestamp 後面沒有任何 channel 欄位')
    timeOf = (cells) => datetimeToSeconds(cells[tsIdx])
    timeLabel = 'timestamp'
  } else {
    throw new CsvFormatError("格式有問題:找不到 't_mono' 或 'timestamp' 欄位(預期格式:t_mono, timestamp, chan1…chan16)")
  }

  const timeRaw: number[] = []
  const channels: number[][] = channelNames.map(() => [])

  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue
    const cells = splitRow(lines[r])
    const t = timeOf(cells)
    if (!isFinite(t)) {
      throw new CsvFormatError(`格式有問題:第 ${r + 1} 列的時間值(${timeLabel})無法解析`)
    }
    timeRaw.push(t)
    for (let c = 0; c < channelNames.length; c++) {
      const v = parseFloat(cells[channelStartIdx + c])
      channels[c].push(isFinite(v) ? v : 0)
    }
  }

  if (timeRaw.length < 2) throw new CsvFormatError('格式有問題:有效資料列不足(至少需要 2 列)')

  const t0 = timeRaw[0]
  return { timeSeconds: timeRaw.map((t) => t - t0), channelNames, channels }
}

/** Parse "YYYY-MM-DD HH:MM:SS.ffffff" (or ISO) to seconds, keeping full sub-second precision. */
function datetimeToSeconds(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(s.trim())
  if (!m) return NaN
  const days = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000
  return days * 86400 + +m[4] * 3600 + +m[5] * 60 + +m[6] + (m[7] ? parseFloat('0.' + m[7]) : 0)
}

// ---------- resample_to_target_rate (linear interp + extrapolate) ----------

function linInterp(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  if (x <= xs[0]) {
    const slope = (ys[1] - ys[0]) / (xs[1] - xs[0] || 1)
    return ys[0] + slope * (x - xs[0])
  }
  if (x >= xs[n - 1]) {
    const slope = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2] || 1)
    return ys[n - 1] + slope * (x - xs[n - 1])
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return ys[lo] + (ys[hi] - ys[lo]) * f
}

function resample(t: number[], channels: number[][], rate: number): { t: number[]; channels: number[][] } {
  const start = t[0]
  const end = t[t.length - 1]
  const step = 1.0 / rate
  // np.arange(start, end, step): length = ceil((end-start)/step), value = start + i*step
  // (compute values from i rather than accumulating, to match numpy exactly).
  const count = Math.max(0, Math.ceil((end - start) / step - 1e-9))
  const tRes = new Array<number>(count)
  for (let i = 0; i < count; i++) tRes[i] = start + i * step
  const out = channels.map((ch) => tRes.map((tr) => linInterp(t, ch, tr)))
  return { t: tRes, channels: out }
}

// ---------- normalize ----------

function normalize(channels: number[][]): number[][] {
  return channels.map((v) => {
    let mn = Infinity
    let mx = -Infinity
    for (const x of v) {
      if (x < mn) mn = x
      if (x > mx) mx = x
    }
    return v.map((x) => (x - mn) / (mx - mn + 1e-8))
  })
}

// ---------- Savitzky–Golay (mode='interp', matching scipy) ----------

function invertMatrix(M: number[][]): number[][] {
  const n = M.length
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    const d = A[col][col]
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col]
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j]
    }
  }
  return A.map((row) => row.slice(n))
}

/** The w×w hat matrix H = A (AᵀA)⁻¹ Aᵀ for a length-w window, polyorder p. */
function savgolHat(w: number, p: number): number[][] {
  const c = (w - 1) / 2
  const A: number[][] = []
  for (let i = 0; i < w; i++) {
    const row: number[] = []
    for (let j = 0; j <= p; j++) row.push((i - c) ** j)
    A.push(row)
  }
  const n = p + 1
  const AtA: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      let s = 0
      for (let i = 0; i < w; i++) s += A[i][a] * A[i][b]
      AtA[a][b] = s
    }
  const inv = invertMatrix(AtA)
  const P: number[][] = Array.from({ length: n }, () => new Array(w).fill(0))
  for (let a = 0; a < n; a++)
    for (let i = 0; i < w; i++) {
      let s = 0
      for (let b = 0; b < n; b++) s += inv[a][b] * A[i][b]
      P[a][i] = s
    }
  const H: number[][] = Array.from({ length: w }, () => new Array(w).fill(0))
  for (let r = 0; r < w; r++)
    for (let col = 0; col < w; col++) {
      let s = 0
      for (let a = 0; a < n; a++) s += A[r][a] * P[a][col]
      H[r][col] = s
    }
  return H
}

function savgolFilter(y: number[], w: number, p: number): number[] {
  const n = y.length
  const m = (w - 1) / 2
  const H = savgolHat(w, p)
  const out = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (i < m) {
      let s = 0
      for (let k = 0; k < w; k++) s += H[i][k] * y[k]
      out[i] = s
    } else if (i >= n - m) {
      const rowIdx = i - (n - w)
      let s = 0
      for (let k = 0; k < w; k++) s += H[rowIdx][k] * y[n - w + k]
      out[i] = s
    } else {
      let s = 0
      for (let k = 0; k < w; k++) s += H[m][k] * y[i - m + k]
      out[i] = s
    }
  }
  return out
}

/** Port of _valid_sg_params — adjusts (or rejects) the SG window/poly for short data. */
function validSgParams(nRows: number, w: number, p: number): { w: number; p: number } | null {
  if (nRows < 5) return null
  if (w % 2 === 0) w += 1
  if (w < 5) w = 5
  if (w >= nRows) {
    w = nRows - 1
    if (w % 2 === 0) w -= 1
    if (w < 5) return null
  }
  if (p >= w) p = w - 1
  if (p < 1) p = 1
  return { w, p }
}

// ---------- top-level: process one raw FMG CSV ----------

export function processFmgCsv(text: string): ProcessResult {
  const raw = loadAndAlign(text)
  const resampled = resample(raw.timeSeconds, raw.channels, PROCESS_PARAMS.FMG_TARGET_RATE)
  let channels = normalize(resampled.channels)

  const sg = validSgParams(resampled.t.length, PROCESS_PARAMS.SG_WINDOW, PROCESS_PARAMS.SG_POLY)
  if (sg) channels = channels.map((ch) => savgolFilter(ch, sg.w, sg.p))

  const t = resampled.t
  const names = raw.channelNames

  // build processed CSV text
  const header = ['timestamp', ...names].join(',')
  const lines = [header]
  for (let i = 0; i < t.length; i++) {
    const row = [t[i].toFixed(6)]
    for (let c = 0; c < channels.length; c++) row.push(channels[c][i].toFixed(6))
    lines.push(row.join(','))
  }

  // build CsvData for the editor
  const series: Series[] = names.map((name, c) => {
    const pts = t.map((tv, i) => ({ t: tv, v: channels[c][i] }))
    let mn = Infinity
    let mx = -Infinity
    for (const pt of pts) {
      if (pt.v < mn) mn = pt.v
      if (pt.v > mx) mx = pt.v
    }
    return { name, points: pts, min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 1 }
  })

  return {
    csvText: lines.join('\n'),
    data: { duration: t.length ? t[t.length - 1] : 0, series, timeColumn: 'timestamp' },
    rows: t.length,
    channels: channels.length,
  }
}
