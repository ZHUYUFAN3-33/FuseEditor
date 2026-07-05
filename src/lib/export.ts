import type { Clip, GainMap, Keyframe, MediaSource, Project, Series } from '../types'
import { intensityAt, scheduleGain } from './automation'

function sampleSeries(s: Series, t: number): number | null {
  const p = s.points
  if (!p.length) return null
  if (t <= p[0].t) return p[0].v
  if (t >= p[p.length - 1].t) return p[p.length - 1].v
  for (let i = 1; i < p.length; i++) {
    if (p[i].t >= t) {
      const a = p[i - 1]
      const b = p[i]
      return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t || 1))
    }
  }
  return null
}

// ---------------- audio mixdown (offline, exact) ----------------

/** Render the whole timeline's audio to a stereo WAV, honoring the mixer. */
export async function renderTimelineToWav(
  project: Project,
  sources: Record<string, MediaSource>,
  gains: GainMap,
  masterVolume: number,
  totalDuration: number,
  includeTrackIds?: string[],
): Promise<Blob> {
  // When isolating tracks (per-track export), apply each track's own volume only and
  // ignore mute/solo of other tracks.
  const include = includeTrackIds && includeTrackIds.length ? new Set(includeTrackIds) : null
  const sampleRate = 44100
  const length = Math.max(1, Math.ceil(totalDuration * sampleRate))
  const offline = new OfflineAudioContext(2, length, sampleRate)

  const master = offline.createGain()
  master.gain.value = masterVolume
  master.connect(offline.destination)

  const anySolo = Object.values(gains).some((s) => s.solo)
  const trackGain = new Map<string, GainNode>()
  const getTG = (trackId: string): GainNode => {
    let g = trackGain.get(trackId)
    if (!g) {
      g = offline.createGain()
      const s = gains[trackId]
      const base = include ? s?.volume ?? 1 : s ? (!s.muted && (!anySolo || s.solo) ? s.volume : 0) : 1
      // follow the track's volume keyframe curve over the timeline (absolute: ctx time = timeline time)
      scheduleGain(g.gain, project.tracks.find((t) => t.id === trackId)?.intensity, base, 0, 0)
      g.connect(master)
      trackGain.set(trackId, g)
    }
    return g
  }

  for (const clip of project.clips) {
    if (include && !include.has(clip.trackId)) continue
    const buf = sources[clip.sourceId]?.audioBuffer
    if (!buf) continue
    const dur = Math.min(clip.duration, buf.duration - clip.inPoint)
    if (dur <= 0) continue
    const node = offline.createBufferSource()
    node.buffer = buf
    node.connect(getTG(clip.trackId))
    node.start(clip.start, clip.inPoint, dur)
  }

  return audioBufferToWav(await offline.startRendering())
}

function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels
  const sampleRate = buf.sampleRate
  const numFrames = buf.length
  const blockAlign = numCh * 2
  const dataSize = numFrames * blockAlign
  const arr = new ArrayBuffer(44 + dataSize)
  const view = new DataView(arr)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let c = 0; c < numCh; c++) channels.push(buf.getChannelData(c))
  let off = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

// ---------------- CSV export (timeline-aligned, gap-filled with 0) ----------------

/**
 * Build one CSV aligned to the whole timeline (video length).
 *
 * Columns are grouped per CSV track + channel, so splitting a clip does NOT
 * duplicate columns. The time axis runs continuously 0..exportLength at the
 * given sample rate; wherever a track has no clip covering a time (scene
 * transitions, head/tail gaps), that track's value is 0 — the servo signal
 * never stops and the export length matches the video exactly.
 */
export function buildTimelineCsv(
  project: Project,
  sources: Record<string, MediaSource>,
  sampleRate: number,
  exportLength: number,
  includeTrackIds?: string[],
): string {
  // CSV tracks, in track order. A track's channels come from the first CSV clip on it.
  const include = includeTrackIds && includeTrackIds.length ? new Set(includeTrackIds) : null
  const csvTracks = project.tracks.filter(
    (t) =>
      (!include || include.has(t.id)) &&
      project.clips.some((c) => c.trackId === t.id && sources[c.sourceId]?.csv),
  )
  if (!csvTracks.length || !Number.isFinite(exportLength) || exportLength <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return ''
  }

  const multi = csvTracks.length > 1
  const columns: { trackId: string; channel: string; header: string }[] = []
  for (const track of csvTracks) {
    const firstClip = project.clips.find((c) => c.trackId === track.id && sources[c.sourceId]?.csv)!
    const csv = sources[firstClip.sourceId]!.csv!
    for (const s of csv.series) {
      columns.push({ trackId: track.id, channel: s.name, header: multi ? `${track.name}:${s.name}` : s.name })
    }
  }

  // Clips per track, sorted by start so the covering-clip lookup is deterministic.
  const clipsByTrack = new Map<string, typeof project.clips>()
  const intensityByTrack = new Map<string, Keyframe[] | undefined>()
  for (const track of csvTracks) {
    clipsByTrack.set(
      track.id,
      project.clips.filter((c) => c.trackId === track.id && sources[c.sourceId]?.csv).sort((a, b) => a.start - b.start),
    )
    // keyframes are stored in edit order (drag-by-index) — sort once for sampling
    intensityByTrack.set(track.id, track.intensity ? [...track.intensity].sort((a, b) => a.t - b.t) : undefined)
  }

  // sample one clip's channel at timeline time t, holding at the clip's own edges
  const sampleClip = (clip: Clip, channel: string, t: number): number => {
    const series = sources[clip.sourceId]?.csv?.series.find((s) => s.name === channel)
    if (!series) return 0
    let srcT = t - clip.start + clip.inPoint
    srcT = Math.min(clip.inPoint + clip.duration, Math.max(clip.inPoint, srcT))
    const v = sampleSeries(series, srcT)
    return v == null ? 0 : v
  }

  // per-clip fade-in / fade-out ramp (0..1)
  const fadeFactor = (clip: Clip, t: number): number => {
    const local = t - clip.start
    let f = 1
    if (clip.fadeIn && clip.fadeIn > 0 && local < clip.fadeIn) f = Math.min(f, local / clip.fadeIn)
    if (clip.fadeOut && clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) f = Math.min(f, (clip.duration - local) / clip.fadeOut)
    return Math.max(0, Math.min(1, f))
  }

  const step = 1 / sampleRate
  const nRows = Math.min(5_000_000, Math.floor(exportLength / step + 1e-9) + 1)
  const lines = ['time,' + columns.map((c) => c.header).join(',')]
  for (let i = 0; i < nRows; i++) {
    const t = i * step
    const cells = [t.toFixed(6)]
    for (const col of columns) {
      let value = 0 // gap / no-data → 0 (servo neutral)
      const clip = clipsByTrack.get(col.trackId)!.find((c) => t >= c.start - 1e-9 && t <= c.start + c.duration + 1e-9)
      if (clip) value = sampleClip(clip, col.channel, t) * fadeFactor(clip, t)
      value *= intensityAt(intensityByTrack.get(col.trackId), t) // per-track intensity envelope
      cells.push(Number(value.toFixed(6)).toString())
    }
    lines.push(cells.join(','))
  }
  return lines.join('\n')
}


// ---------------- download helpers ----------------

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(text: string, filename: string, mime = 'text/csv') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}
