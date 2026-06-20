import type { GainMap, MediaSource, Project, Series } from '../types'

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
): Promise<Blob> {
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
      const on = s ? !s.muted && (!anySolo || s.solo) : true
      g.gain.value = on ? s?.volume ?? 1 : 0
      g.connect(master)
      trackGain.set(trackId, g)
    }
    return g
  }

  for (const clip of project.clips) {
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

// ---------------- CSV export (timeline-aligned) ----------------

/** Build one CSV with a time column + every CSV clip's series, sampled on a shared grid. */
export function buildTimelineCsv(project: Project, sources: Record<string, MediaSource>): string {
  const cols: { clipStart: number; clipEnd: number; inPoint: number; series: Series; name: string }[] = []
  let total = 0
  for (const clip of project.clips) {
    const csv = sources[clip.sourceId]?.csv
    if (!csv) continue
    total = Math.max(total, clip.start + clip.duration)
    for (const s of csv.series) {
      cols.push({ clipStart: clip.start, clipEnd: clip.start + clip.duration, inPoint: clip.inPoint, series: s, name: `${clip.name}:${s.name}` })
    }
  }
  if (!cols.length) return ''

  const rows = Math.min(20000, Math.max(100, Math.ceil(total * 50)))
  const interval = total / rows
  const lines = ['time,' + cols.map((c) => c.name).join(',')]
  for (let i = 0; i <= rows; i++) {
    const t = i * interval
    const cells = [t.toFixed(3)]
    for (const col of cols) {
      let cell = ''
      if (t >= col.clipStart - 1e-9 && t <= col.clipEnd + 1e-9) {
        const v = sampleSeries(col.series, t - col.clipStart + col.inPoint)
        if (v != null) cell = String(Number(v.toFixed(6)))
      }
      cells.push(cell)
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
