import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import Preview from './components/Preview'
import Inspector from './components/Inspector'
import Timeline from './components/Timeline'
import ResizeHandle from './components/ResizeHandle'
import ExportDialog from './components/ExportDialog'
import LibraryPanel from './components/LibraryPanel'
import type { Tool } from './components/Clip'
import type { Clip, GainMap, MediaSource, Project, RawItem, Series, Track, TrackKind, TrackMix } from './types'
import { decodeAudio, getMediaDuration } from './lib/audio'
import { intensityAt } from './lib/automation'
import { useHistory } from './lib/history'
import { AudioEngine } from './lib/engine'
import { resolveStart } from './lib/clips'
import { CsvFormatError, processFmgCsv, isProcessedCsv, parseProcessedCsv, isConstantCarrier, loadCarrierCsv, makeCarrierCsv } from './lib/process'
import { buildTimelineCsv, downloadBlob, downloadText, renderTimelineToWav } from './lib/export'
import { loadMedia, loadSnapshot, saveMedia, saveSnapshot } from './lib/storage'
import { parseProjectFile, serializeProject, type ProjectSnapshot } from './lib/projectFile'
import './styles/app.css'

let _seq = 0
const id = (p: string) => `${p}_${++_seq}`
// Keep the id counter ahead of any ids restored from a saved project.
function bumpSeq(ids: string[]) {
  for (const x of ids) {
    const m = /_(\d+)$/.exec(x)
    if (m && +m[1] > _seq) _seq = +m[1]
  }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MIN_DUR = 0.05
const DEFAULT_MIX: TrackMix = { muted: false, solo: false, volume: 1, locked: false }

const COLORS: Record<TrackKind, string> = { video: '#4f7cff', audio: '#2dbd8f', csv: '#e0913a' }
const TRACK_BASE: Record<TrackKind, string> = { video: 'Video', audio: 'Audio', csv: 'Data' }
const KIND_ORDER: Record<TrackKind, number> = { video: 0, audio: 1, csv: 2 }
const MAX_PER_KIND = 8

function nextTrackName(kind: TrackKind, tracks: Track[]): string {
  return `${TRACK_BASE[kind]} ${tracks.filter((t) => t.kind === kind).length + 1}`
}

/** Insert a track grouped with others of its kind (video → audio → csv top to bottom). */
function insertGrouped(tracks: Track[], track: Track): Track[] {
  let lastIdx = -1
  for (let i = 0; i < tracks.length; i++) if (tracks[i].kind === track.kind) lastIdx = i
  if (lastIdx >= 0) return [...tracks.slice(0, lastIdx + 1), track, ...tracks.slice(lastIdx + 1)]
  let at = tracks.length
  for (let i = 0; i < tracks.length; i++) {
    if (KIND_ORDER[tracks[i].kind] > KIND_ORDER[track.kind]) {
      at = i
      break
    }
  }
  return [...tracks.slice(0, at), track, ...tracks.slice(at)]
}

/** Default DaVinci-style tracks, present from the start (headers show even when empty). */
function makeInitialProject(): Project {
  return {
    tracks: [
      { id: id('trk'), kind: 'video', name: 'Video 1', color: COLORS.video },
      { id: id('trk'), kind: 'audio', name: 'Audio 1', color: COLORS.audio },
      { id: id('trk'), kind: 'csv', name: 'Data 1', color: COLORS.csv },
    ],
    clips: [],
  }
}

function detectKind(file: File): TrackKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type === 'text/csv' || /\.csv$/i.test(file.name)) return 'csv'
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) return 'video'
  if (/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file.name)) return 'audio'
  return null
}

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

export default function App() {
  const [initialProject] = useState(makeInitialProject)
  const history = useHistory<Project>(initialProject)
  const project = history.state

  const [sources, setSources] = useState<Record<string, MediaSource>>({})
  const [mixer, setMixer] = useState<Record<string, TrackMix>>({})
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40)
  const [trackHeight, setTrackHeight] = useState(92)
  const [ampScale, setAmpScale] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [snap, setSnap] = useState(true)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [frameRate, setFrameRate] = useState(60) // fps for the ◁ ▷ frame-step buttons
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [masterVolume, setMasterVolume] = useState(1)
  const [busy, setBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [rawData, setRawData] = useState<RawItem[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)

  // persistence
  const mediaFiles = useRef<Map<string, File>>(new Map()) // sourceId -> original File, for autosave + relink
  const [storageReady, setStorageReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const projectInput = useRef<HTMLInputElement>(null)
  const relinkInput = useRef<HTMLInputElement>(null)
  const relinkTargetId = useRef<string | null>(null)
  const relinkAllInput = useRef<HTMLInputElement>(null)
  const lastMediaSig = useRef('')

  const [mediaWidth, setMediaWidth] = useState(240)
  const [inspectorWidth, setInspectorWidth] = useState(272)
  const [timelineHeight, setTimelineHeight] = useState(320)

  const fileInput = useRef<HTMLInputElement>(null)

  const totalDuration = useMemo(
    () => Math.max(30, ...project.clips.map((c) => c.start + c.duration), 0),
    [project.clips],
  )

  const gains: GainMap = useMemo(() => {
    const g: GainMap = {}
    for (const t of project.tracks) {
      const m = mixer[t.id] ?? DEFAULT_MIX
      g[t.id] = { muted: m.muted, solo: m.solo, volume: m.volume }
    }
    return g
  }, [project.tracks, mixer])

  // ---------- live refs for the audio clock / scheduler ----------
  const engineRef = useRef<AudioEngine | null>(null)
  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new AudioEngine()
    return engineRef.current
  }
  const ref = {
    playhead: useRef(playhead),
    project: useRef(project),
    sources: useRef(sources),
    gains: useRef(gains),
    loop: useRef(loop),
    total: useRef(totalDuration),
    master: useRef(masterVolume),
    playing: useRef(isPlaying),
  }
  ref.playhead.current = playhead
  ref.project.current = project
  ref.sources.current = sources
  ref.gains.current = gains
  ref.loop.current = loop
  ref.total.current = totalDuration
  ref.master.current = masterVolume
  ref.playing.current = isPlaying

  // ---------- import (stage ①: media → library, raw CSV → process queue) ----------
  const importFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    const addedSources: Record<string, MediaSource> = {}
    const addedRaw: RawItem[] = []
    try {
      for (const file of Array.from(fileList)) {
        const kind = detectKind(file)
        if (!kind) continue

        // Re-link: this file restores a media source loaded from a .experium project.
        const relink =
          kind !== 'csv'
            ? Object.values(ref.sources.current).find((s) => s.needsRelink && s.kind === kind && s.name === file.name)
            : undefined
        if (relink) {
          if (kind === 'video') {
            mediaFiles.current.set(relink.id, file)
            addedSources[relink.id] = { ...relink, mediaUrl: URL.createObjectURL(file), needsRelink: undefined }
            const aud = relink.linkedAudioId ? ref.sources.current[relink.linkedAudioId] : undefined
            if (aud?.needsRelink) {
              try {
                const { audioBuffer, waveform } = await decodeAudio(file)
                mediaFiles.current.set(aud.id, file)
                addedSources[aud.id] = { ...aud, audioBuffer, waveform, needsRelink: undefined }
              } catch {
                /* keep needing relink */
              }
            }
          } else {
            try {
              const { audioBuffer, waveform } = await decodeAudio(file)
              mediaFiles.current.set(relink.id, file)
              addedSources[relink.id] = { ...relink, audioBuffer, waveform, needsRelink: undefined }
            } catch {
              /* keep needing relink */
            }
          }
          continue
        }

        if (kind === 'video') {
          const url = URL.createObjectURL(file)
          const dur = (await getMediaDuration(url, 'video')) || 0
          let decoded
          try {
            decoded = await decodeAudio(file)
          } catch {
            /* no decodable audio */
          }
          const audioDur = decoded?.waveform.duration ?? 0
          let realDur = Number.isFinite(dur) && dur > 0 ? dur : audioDur
          if (!(realDur > 0)) {
            console.warn(`Could not read duration for "${file.name}"; using a 10s placeholder. Trim to fit.`)
            realDur = 10
          }
          const vSrc: MediaSource = { id: id('src'), kind: 'video', name: file.name, fullDuration: realDur, mediaUrl: url }
          mediaFiles.current.set(vSrc.id, file)
          if (decoded) {
            const aSrc: MediaSource = { id: id('src'), kind: 'audio', name: `${file.name} · audio`, fullDuration: decoded.waveform.duration, waveform: decoded.waveform, audioBuffer: decoded.audioBuffer }
            addedSources[aSrc.id] = aSrc
            mediaFiles.current.set(aSrc.id, file)
            vSrc.linkedAudioId = aSrc.id
          }
          addedSources[vSrc.id] = vSrc
        } else if (kind === 'audio') {
          const { audioBuffer, waveform } = await decodeAudio(file)
          const src: MediaSource = { id: id('src'), kind: 'audio', name: file.name, fullDuration: waveform.duration, waveform, audioBuffer }
          mediaFiles.current.set(src.id, file)
          addedSources[src.id] = src
        } else {
          const text = await file.text()
          if (isProcessedCsv(text)) {
            // already processed (from the user's Python) → straight to the library, skip stage ②
            try {
              const csv = parseProcessedCsv(text)
              const src: MediaSource = { id: id('src'), kind: 'csv', name: file.name, fullDuration: csv.duration, csv }
              addedSources[src.id] = src
            } catch (e) {
              addedRaw.push({ id: id('raw'), name: file.name, text, error: e instanceof CsvFormatError ? e.message : String(e) })
            }
          } else if (isConstantCarrier(text)) {
            // a constant "carrier" (e.g. all-ones editing template) → load WITHOUT normalize (which would zero it)
            try {
              const csv = loadCarrierCsv(text).data
              const src: MediaSource = { id: id('src'), kind: 'csv', name: file.name, fullDuration: csv.duration, csv }
              addedSources[src.id] = src
            } catch (e) {
              addedRaw.push({ id: id('raw'), name: file.name, text, error: e instanceof CsvFormatError ? e.message : String(e) })
            }
          } else {
            // raw CSV → process queue (stage ②), not the timeline yet
            addedRaw.push({ id: id('raw'), name: file.name, text })
          }
        }
      }
      if (Object.keys(addedSources).length) setSources((prev) => ({ ...prev, ...addedSources }))
      if (addedRaw.length) setRawData((prev) => [...prev, ...addedRaw])
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- stage ②: process a raw CSV into a ready source ----------
  const processRaw = useCallback((rawId: string) => {
    setProcessingId(rawId)
    // Defer so the spinner can paint before the (synchronous) heavy work.
    setTimeout(() => {
      setRawData((prev) => {
        const item = prev.find((r) => r.id === rawId)
        if (!item) return prev
        try {
          // a constant carrier (all-ones template) must skip normalize/SG or it collapses to 0
          const result = isConstantCarrier(item.text) ? loadCarrierCsv(item.text) : processFmgCsv(item.text)
          const src: MediaSource = { id: id('src'), kind: 'csv', name: item.name.replace(/\.csv$/i, '') + '-processed.csv', fullDuration: result.data.duration, csv: result.data }
          setSources((s) => ({ ...s, [src.id]: src }))
          return prev.filter((r) => r.id !== rawId)
        } catch (e) {
          const msg = e instanceof CsvFormatError ? e.message : `處理失敗:${e instanceof Error ? e.message : String(e)}`
          return prev.map((r) => (r.id === rawId ? { ...r, error: msg } : r))
        }
      })
      setProcessingId(null)
    }, 30)
  }, [])

  const processAllRaw = useCallback(() => {
    rawData.forEach((r) => processRaw(r.id))
  }, [rawData, processRaw])

  const removeRaw = useCallback((rawId: string) => setRawData((prev) => prev.filter((r) => r.id !== rawId)), [])

  // Delete a source from the pool (+ its extracted audio, blobs, and any clips using it).
  const removeSource = useCallback(
    (sourceId: string) => {
      const src = sources[sourceId]
      if (!src) return
      const ids = new Set<string>([sourceId])
      if (src.kind === 'video' && src.linkedAudioId) ids.add(src.linkedAudioId)
      const usedClips = project.clips.filter((c) => ids.has(c.sourceId))
      if (usedClips.length && !window.confirm(`「${src.name}」在時間軸上有 ${usedClips.length} 個片段,要連同片段一起刪除嗎?`)) return
      for (const did of ids) {
        const s = sources[did]
        if (s?.mediaUrl) URL.revokeObjectURL(s.mediaUrl)
        mediaFiles.current.delete(did)
      }
      setSources((prev) => {
        const n = { ...prev }
        ids.forEach((did) => delete n[did])
        return n
      })
      if (usedClips.length) {
        if (selectedClipId && usedClips.some((c) => c.id === selectedClipId)) setSelectedClipId(null)
        history.commit({ ...project, clips: project.clips.filter((c) => !ids.has(c.sourceId)) })
      }
    },
    [sources, project, history, selectedClipId],
  )

  // Re-link a specific missing media source to a file the user picks (no name matching).
  const relinkSource = useCallback(async (sourceId: string, file: File) => {
    const src = ref.sources.current[sourceId]
    if (!src) return
    setBusy(true)
    try {
      const updated: Record<string, MediaSource> = {}
      if (src.kind === 'video') {
        mediaFiles.current.set(src.id, file)
        updated[src.id] = { ...src, mediaUrl: URL.createObjectURL(file), needsRelink: undefined }
        const aud = src.linkedAudioId ? ref.sources.current[src.linkedAudioId] : undefined
        if (aud?.needsRelink) {
          try {
            const { audioBuffer, waveform } = await decodeAudio(file)
            mediaFiles.current.set(aud.id, file)
            updated[aud.id] = { ...aud, audioBuffer, waveform, needsRelink: undefined }
          } catch {
            /* keep needing relink */
          }
        }
      } else if (src.kind === 'audio') {
        const { audioBuffer, waveform } = await decodeAudio(file)
        mediaFiles.current.set(src.id, file)
        updated[src.id] = { ...src, audioBuffer, waveform, needsRelink: undefined }
      }
      if (Object.keys(updated).length) setSources((prev) => ({ ...prev, ...updated }))
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRelink = useCallback((sourceId: string) => {
    relinkTargetId.current = sourceId
    relinkInput.current?.click()
  }, [])

  // Bulk re-link: pick many files at once, auto-match each to a source by its original name.
  const relinkAll = useCallback(async (files: FileList) => {
    const list = Array.from(files)
    if (!list.length) return
    setBusy(true)
    try {
      const snap = ref.sources.current
      const updated: Record<string, MediaSource> = {}
      let matched = 0
      for (const file of list) {
        const targets = Object.values(snap).filter(
          (s) => s.needsRelink && !updated[s.id] && s.name === file.name,
        )
        if (!targets.length) continue
        let decoded: Awaited<ReturnType<typeof decodeAudio>> | null = null
        const ensureDecoded = async () => decoded ?? (decoded = await decodeAudio(file))
        for (const src of targets) {
          if (src.kind === 'video') {
            mediaFiles.current.set(src.id, file)
            updated[src.id] = { ...src, mediaUrl: URL.createObjectURL(file), needsRelink: undefined }
            const aud = src.linkedAudioId ? snap[src.linkedAudioId] : undefined
            if (aud?.needsRelink && !updated[aud.id]) {
              try {
                const { audioBuffer, waveform } = await ensureDecoded()
                mediaFiles.current.set(aud.id, file)
                updated[aud.id] = { ...aud, audioBuffer, waveform, needsRelink: undefined }
              } catch {
                /* leave the linked audio needing relink */
              }
            }
            matched++
          } else if (src.kind === 'audio') {
            try {
              const { audioBuffer, waveform } = await ensureDecoded()
              mediaFiles.current.set(src.id, file)
              updated[src.id] = { ...src, audioBuffer, waveform, needsRelink: undefined }
              matched++
            } catch {
              /* leave needing relink */
            }
          }
        }
      }
      if (Object.keys(updated).length) setSources((prev) => ({ ...prev, ...updated }))
      const remaining = Object.values({ ...snap, ...updated }).filter(
        (s) => s.needsRelink && !s.name.endsWith(' · audio'),
      ).length
      if (matched === 0) {
        window.alert('No files matched — the selected files must keep their original names to auto-link.')
      } else if (remaining > 0) {
        window.alert(`Re-linked ${matched} file(s). ${remaining} still missing — pick those too.`)
      }
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRelinkAll = useCallback(() => relinkAllInput.current?.click(), [])

  // ---------- stage ③: drag a library source onto a specific track at a time ----------
  const [draggingKind, setDraggingKind] = useState<TrackKind | null>(null)

  const dropSourceOnTrack = useCallback(
    (sourceId: string, trackId: string, startSec: number) => {
      const src = sources[sourceId]
      const track = project.tracks.find((t) => t.id === trackId)
      if (!src || !track || src.kind !== track.kind) return // only same-kind tracks
      if ((mixer[trackId] ?? DEFAULT_MIX).locked) return
      // a track can hold many clips (a sequence) — just snap to a free slot, no overlap
      const start = resolveStart(project.clips.filter((c) => c.trackId === trackId), Math.max(0, startSec), src.fullDuration)
      let tracks = project.tracks
      const newClips: Clip[] = [{ id: id('clp'), sourceId: src.id, trackId, name: src.name, start, inPoint: 0, duration: src.fullDuration }]
      if (src.kind === 'video' && src.linkedAudioId && sources[src.linkedAudioId]) {
        const aud = sources[src.linkedAudioId]
        let audTrack = tracks.find((t) => t.kind === 'audio')
        if (!audTrack) {
          audTrack = { id: id('trk'), kind: 'audio', name: nextTrackName('audio', tracks), color: COLORS.audio }
          tracks = insertGrouped(tracks, audTrack)
        }
        const audStart = resolveStart(project.clips.filter((c) => c.trackId === audTrack!.id), start, aud.fullDuration)
        newClips.push({ id: id('clp'), sourceId: aud.id, trackId: audTrack.id, name: aud.name, start: audStart, inPoint: 0, duration: aud.fullDuration })
      }
      history.commit({ tracks, clips: [...project.clips, ...newClips] })
    },
    [history, project, sources, mixer],
  )

  // ---------- mixer ----------
  const getMix = useCallback((trackId: string): TrackMix => mixer[trackId] ?? DEFAULT_MIX, [mixer])
  const setTrackMix = useCallback(
    (trackId: string, patch: Partial<TrackMix>) =>
      setMixer((m) => ({ ...m, [trackId]: { ...(m[trackId] ?? DEFAULT_MIX), ...patch } })),
    [],
  )

  // ---------- discrete edit actions ----------
  const addTrack = useCallback(
    (kind: TrackKind) => {
      if (project.tracks.filter((t) => t.kind === kind).length >= MAX_PER_KIND) return
      const trk: Track = { id: id('trk'), kind, name: nextTrackName(kind, project.tracks), color: COLORS[kind] }
      history.commit({ ...project, tracks: insertGrouped(project.tracks, trk) })
    },
    [history, project],
  )

  const renameTrack = useCallback(
    (trackId: string, name: string) => {
      const clean = name.trim()
      if (!clean) return
      history.commit({ ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, name: clean } : t)) })
    },
    [history, project],
  )

  const removeTrack = useCallback(
    (trackId: string) => {
      if (project.tracks.length <= 1) return // keep at least one track
      const removed = new Set(project.clips.filter((c) => c.trackId === trackId).map((c) => c.id))
      if (selectedClipId && removed.has(selectedClipId)) setSelectedClipId(null)
      history.commit({ tracks: project.tracks.filter((t) => t.id !== trackId), clips: project.clips.filter((c) => c.trackId !== trackId) })
    },
    [history, project, selectedClipId],
  )

  const splitClipAt = useCallback(
    (clipId: string, offsetSec: number) => {
      const c = project.clips.find((x) => x.id === clipId)
      if (!c || offsetSec <= MIN_DUR || offsetSec >= c.duration - MIN_DUR) return
      const left: Clip = { ...c, duration: offsetSec }
      const right: Clip = { ...c, id: id('clp'), start: c.start + offsetSec, inPoint: c.inPoint + offsetSec, duration: c.duration - offsetSec }
      history.commit({ ...project, clips: project.clips.flatMap((x) => (x.id === clipId ? [left, right] : [x])) })
    },
    [history, project],
  )

  const splitAtPlayhead = useCallback(() => {
    const next: Clip[] = []
    let changed = false
    for (const c of project.clips) {
      if ((mixer[c.trackId] ?? DEFAULT_MIX).locked) {
        next.push(c)
        continue
      }
      const off = playhead - c.start
      if (off > MIN_DUR && off < c.duration - MIN_DUR) {
        changed = true
        next.push({ ...c, duration: off })
        next.push({ ...c, id: id('clp'), start: c.start + off, inPoint: c.inPoint + off, duration: c.duration - off })
      } else next.push(c)
    }
    if (changed) history.commit({ ...project, clips: next })
  }, [history, project, playhead, mixer])

  const mergeSelected = useCallback(() => {
    if (!selectedClipId) return
    const sel = project.clips.find((c) => c.id === selectedClipId)
    if (!sel) return
    const next = project.clips
      .filter((c) => c.id !== sel.id && c.trackId === sel.trackId && c.sourceId === sel.sourceId)
      .filter((c) => Math.abs(c.start - (sel.start + sel.duration)) < 0.02)
      .sort((a, b) => a.start - b.start)[0]
    if (!next) return
    const merged: Clip = { ...sel, duration: next.start + next.duration - sel.start }
    history.commit({ ...project, clips: project.clips.flatMap((c) => (c.id === sel.id ? [merged] : c.id === next.id ? [] : [c])) })
  }, [history, project, selectedClipId])

  const deleteSelected = useCallback(
    (ripple: boolean) => {
      if (!selectedClipId) return
      const sel = project.clips.find((c) => c.id === selectedClipId)
      if (!sel) return
      let clips = project.clips.filter((c) => c.id !== selectedClipId)
      if (ripple) {
        clips = clips.map((c) =>
          c.trackId === sel.trackId && c.start >= sel.start + sel.duration - 1e-6
            ? { ...c, start: c.start - sel.duration }
            : c,
        )
      }
      history.commit({ ...project, clips })
      setSelectedClipId(null)
    },
    [history, project, selectedClipId],
  )

  const duplicateSelected = useCallback(() => {
    if (!selectedClipId) return
    const sel = project.clips.find((c) => c.id === selectedClipId)
    if (!sel) return
    const copy: Clip = { ...sel, id: id('clp'), start: sel.start + sel.duration }
    history.commit({ ...project, clips: [...project.clips, copy] })
    setSelectedClipId(copy.id)
  }, [history, project, selectedClipId])

  const nudgeSelected = useCallback(
    (deltaSec: number) => {
      if (!selectedClipId) return
      history.commit({
        ...project,
        clips: project.clips.map((c) =>
          c.id === selectedClipId ? { ...c, start: Math.max(0, c.start + deltaSec) } : c,
        ),
      })
    },
    [history, project, selectedClipId],
  )

  const fit = useCallback((viewportWidth: number) => setPixelsPerSecond(clamp(viewportWidth / totalDuration, 6, 300)), [totalDuration])

  // ---------- export ----------
  // Export length = video duration; fall back to the longest clip if there's no video.
  const exportLength = useMemo(() => {
    // Match the LONGEST media so the servo data spans the whole timeline, padding
    // gaps (no clip) with 0. Counts both what's placed on the timeline (clip ends)
    // AND every imported source's full length — a video/audio only previewed (never
    // dragged onto a track) still defines the master length the export must reach.
    let len = 0
    for (const c of project.clips) {
      const end = c.start + c.duration
      if (Number.isFinite(end) && end > len) len = end
    }
    for (const s of Object.values(sources)) {
      if (Number.isFinite(s.fullDuration) && s.fullDuration > len) len = s.fullDuration
    }
    return len
  }, [project.clips, sources])

  // All exports share one length so audio / video / CSV stay co-terminous.
  const contentLength = exportLength > 0 ? exportLength : totalDuration

  // Generate a neutral all-ones carrier (editing template) matching the current length,
  // straight into the library — draw an envelope over it to author the servo signal.
  const newCarrier = useCallback(() => {
    const secs = exportLength > 0 ? exportLength : 190
    const csv = parseProcessedCsv(makeCarrierCsv(secs, 16))
    const src: MediaSource = { id: id('src'), kind: 'csv', name: `carrier ${Math.round(secs)}s (16ch).csv`, fullDuration: csv.duration, csv }
    setSources((prev) => ({ ...prev, [src.id]: src }))
  }, [exportLength])

  // One WAV file PER selected audio track (each track isolated, at its own volume).
  const exportWav = useCallback(
    async (trackIds: string[]) => {
      if (!trackIds.length) throw new Error('沒有選取任何音頻軌道')
      let made = 0
      for (let i = 0; i < trackIds.length; i++) {
        const tid = trackIds[i]
        const blob = await renderTimelineToWav(project, sources, gains, 1, contentLength, [tid])
        const safe = (project.tracks.find((t) => t.id === tid)?.name ?? tid).replace(/[^\w.\- ]+/g, '_').trim()
        downloadBlob(blob, `${safe || tid}.wav`)
        made++
        if (i < trackIds.length - 1) await new Promise((r) => setTimeout(r, 250))
      }
      if (!made) throw new Error('No audio on the selected tracks')
    },
    [project, sources, gains, contentLength],
  )

  // Audio tracks available for export (have at least one decoded audio clip).
  const audioTrackInfo = useMemo(
    () =>
      project.tracks
        .filter((t) => t.kind === 'audio' && project.clips.some((c) => c.trackId === t.id && sources[c.sourceId]?.audioBuffer))
        .map((t) => ({ id: t.id, name: t.name })),
    [project, sources],
  )

  // CSV tracks available for export (id, label, channel count).
  const csvTrackInfo = useMemo(
    () =>
      project.tracks
        .filter((t) => project.clips.some((c) => c.trackId === t.id && sources[c.sourceId]?.csv))
        .map((t) => {
          const firstClip = project.clips.find((c) => c.trackId === t.id && sources[c.sourceId]?.csv)!
          return { id: t.id, name: t.name, channels: sources[firstClip.sourceId]!.csv!.series.length }
        }),
    [project, sources],
  )

  // One CSV file PER selected track (each track = one data stream, e.g. left / right hand).
  const exportCsv = useCallback(
    async (sampleRate: number, trackIds: string[]) => {
      if (!trackIds.length) throw new Error('沒有選取任何 CSV 軌道')
      if (!(exportLength > 0)) throw new Error('Cannot determine timeline length — re-import the video')
      let made = 0
      for (let i = 0; i < trackIds.length; i++) {
        const tid = trackIds[i]
        const text = buildTimelineCsv(project, sources, sampleRate, exportLength, [tid])
        if (!text) continue
        const safe = (project.tracks.find((t) => t.id === tid)?.name ?? tid).replace(/[^\w.\- ]+/g, '_').trim()
        downloadText(text, `${safe || tid}.csv`)
        made++
        if (i < trackIds.length - 1) await new Promise((r) => setTimeout(r, 250)) // stagger so the browser allows multiple downloads
      }
      if (!made) throw new Error('No CSV data on the selected tracks')
    },
    [project, sources, exportLength],
  )

  const exportVideo = useCallback(
    async (onProgress: (p: number) => void) => {
      const videoClips = project.clips
        .filter((c) => sources[c.sourceId]?.kind === 'video' && sources[c.sourceId]?.mediaUrl)
        .sort((a, b) => a.start - b.start)
      if (!videoClips.length) throw new Error('No video on the timeline')

      const vids = new Map<string, HTMLVideoElement>()
      for (const c of videoClips) {
        const src = sources[c.sourceId]!
        if (!vids.has(src.id)) {
          const v = document.createElement('video')
          v.src = src.mediaUrl!
          v.muted = true
          v.preload = 'auto'
          await new Promise<void>((res) => {
            v.onloadeddata = () => res()
            v.onerror = () => res()
          })
          vids.set(src.id, v)
        }
      }
      const firstV = vids.get(videoClips[0].sourceId)!
      const W = firstV.videoWidth || 1280
      const H = firstV.videoHeight || 720
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const cctx = canvas.getContext('2d')!

      const engine = getEngine()
      const audioStream = engine.createCaptureStream()
      const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30)
      const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()])
      const mime =
        ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ||
        'video/webm'
      const rec = new MediaRecorder(mixed, { mimeType: mime })
      const chunks: BlobPart[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }

      setSelectedClipId(null)
      setIsPlaying(false)
      await engine.play(0, project, sources, gains, masterVolume)
      rec.start(100)

      await new Promise<void>((resolve) => {
        const draw = () => {
          const t = engine.getTime()
          if (t >= contentLength) {
            resolve()
            return
          }
          onProgress(Math.min(1, t / contentLength))
          const clip = videoClips.find((c) => t >= c.start && t <= c.start + c.duration)
          cctx.fillStyle = '#000'
          cctx.fillRect(0, 0, W, H)
          if (clip) {
            const v = vids.get(clip.sourceId)!
            const want = clip.inPoint + (t - clip.start)
            if (Math.abs(v.currentTime - want) > 0.2) v.currentTime = want
            if (v.paused) v.play().catch(() => {})
            vids.forEach((other, sid) => {
              if (sid !== clip.sourceId && !other.paused) other.pause()
            })
            try {
              cctx.drawImage(v, 0, 0, W, H)
            } catch {
              /* frame not ready */
            }
          } else {
            vids.forEach((v) => !v.paused && v.pause())
          }
          requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)
      })

      rec.stop()
      await new Promise<void>((res) => {
        rec.onstop = () => res()
      })
      engine.pause()
      engine.disposeCapture()
      vids.forEach((v) => v.pause())
      downloadBlob(new Blob(chunks, { type: mime }), 'experium-export.webm')
    },
    [project, sources, gains, masterVolume, contentLength],
  )

  // ---------- persistence (A: autosave to IndexedDB · B: .experium file) ----------
  const buildBlobs = useCallback((): Record<string, File> => {
    const blobs: Record<string, File> = {}
    for (const s of Object.values(sources)) {
      if (s.kind === 'csv') continue
      const f = mediaFiles.current.get(s.id)
      if (f) blobs[s.id] = f
    }
    return blobs
  }, [sources])

  const restoreProject = useCallback(
    async (snap: ProjectSnapshot, media: Record<string, File>) => {
      bumpSeq([
        ...snap.project.tracks.map((t) => t.id),
        ...snap.project.clips.map((c) => c.id),
        ...snap.sources.map((s) => s.id),
      ])
      mediaFiles.current = new Map()
      const next: Record<string, MediaSource> = {}
      for (const s of snap.sources) {
        if (s.kind === 'csv') {
          next[s.id] = { id: s.id, kind: 'csv', name: s.name, fullDuration: s.fullDuration, csv: s.csv }
          continue
        }
        const blob = media[s.id]
        if (blob) {
          mediaFiles.current.set(s.id, blob)
          if (s.kind === 'video') {
            next[s.id] = { id: s.id, kind: 'video', name: s.name, fullDuration: s.fullDuration, mediaUrl: URL.createObjectURL(blob), linkedAudioId: s.linkedAudioId }
          } else {
            try {
              const { audioBuffer, waveform } = await decodeAudio(blob)
              next[s.id] = { id: s.id, kind: 'audio', name: s.name, fullDuration: s.fullDuration, audioBuffer, waveform }
            } catch {
              next[s.id] = { id: s.id, kind: 'audio', name: s.name, fullDuration: s.fullDuration, needsRelink: true }
            }
          }
        } else {
          next[s.id] = { id: s.id, kind: s.kind, name: s.name, fullDuration: s.fullDuration, linkedAudioId: s.linkedAudioId, needsRelink: true }
        }
      }
      setSources(next)
      setMixer(snap.mixer ?? {})
      if (snap.view) {
        setPixelsPerSecond(snap.view.pixelsPerSecond)
        setTrackHeight(snap.view.trackHeight)
        setAmpScale(snap.view.ampScale)
        setMasterVolume(snap.view.masterVolume)
      }
      setSelectedClipId(null)
      setPlayhead(0)
      setRawData([])
      history.reset(snap.project)
    },
    [history],
  )

  // Load the last autosaved project on first mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([loadSnapshot<ProjectSnapshot>(), loadMedia()])
      .then(async ([snap, media]) => {
        if (!cancelled && snap?.app === 'experium-editor' && (snap.project.tracks.length || snap.project.clips.length)) {
          try {
            await restoreProject(snap, media ?? {})
          } catch {
            /* ignore corrupt autosave */
          }
        }
      })
      .finally(() => !cancelled && setStorageReady(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced autosave: snapshot every change; media blobs only when they change.
  useEffect(() => {
    if (!storageReady) return
    // Never serialize mid-drag: a live gesture updates the project every frame, and stringifying
    // the whole project (incl. large embedded CSVs) per frame would stall the drag. Saving resumes
    // the moment the gesture ends (history.gesturing flips false → this effect re-runs).
    if (history.gesturing) return
    setSaveStatus('saving')
    const t = setTimeout(async () => {
      try {
        const snap = serializeProject({
          project,
          mixer,
          sources,
          view: { pixelsPerSecond, trackHeight, ampScale, masterVolume },
          savedAt: new Date().toISOString(),
        })
        await saveSnapshot(snap)
        const blobs = buildBlobs()
        const sig = Object.keys(blobs).sort().join('|')
        if (sig !== lastMediaSig.current) {
          await saveMedia(blobs)
          lastMediaSig.current = sig
        }
        setSaveStatus('saved')
      } catch {
        setSaveStatus('idle')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [storageReady, history.gesturing, project, mixer, sources, pixelsPerSecond, trackHeight, ampScale, masterVolume, buildBlobs])

  const saveProjectFile = useCallback(() => {
    const snap = serializeProject({
      project,
      mixer,
      sources,
      view: { pixelsPerSecond, trackHeight, ampScale, masterVolume },
      savedAt: new Date().toISOString(),
    })
    downloadText(JSON.stringify(snap), 'experium-project.experium', 'application/json')
  }, [project, mixer, sources, pixelsPerSecond, trackHeight, ampScale, masterVolume])

  const openProjectFile = useCallback(
    async (file: File) => {
      try {
        const snap = parseProjectFile(await file.text())
        await restoreProject(snap, {})
        lastMediaSig.current = '' // force a media re-save once relinked
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    },
    [restoreProject],
  )

  // ---------- transport ----------
  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, ref.total.current))
    setPlayhead(clamped)
    if (ref.playing.current && engineRef.current) {
      engineRef.current.play(clamped, ref.project.current, ref.sources.current, ref.gains.current, ref.master.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Play/pause driver: anchored to the audio clock, UI follows via rAF.
  useEffect(() => {
    if (!isPlaying) return
    const engine = getEngine()
    // If we're parked at the end, pressing play restarts from the top.
    let startAt = ref.playhead.current
    if (startAt >= ref.total.current - 1e-3) {
      startAt = 0
      setPlayhead(0)
    }
    engine.play(startAt, ref.project.current, ref.sources.current, ref.gains.current, ref.master.current)
    let raf = 0
    const tick = () => {
      const t = engine.getTime()
      if (t >= ref.total.current) {
        if (ref.loop.current) {
          engine.play(0, ref.project.current, ref.sources.current, ref.gains.current, ref.master.current)
          setPlayhead(0)
        } else {
          setPlayhead(ref.total.current)
          setIsPlaying(false)
          return
        }
      } else setPlayhead(Math.min(t, ref.total.current))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      engine.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Keep the playhead inside [0, totalDuration] when edits/undo shrink the timeline.
  useEffect(() => {
    setPlayhead((p) => (p > totalDuration ? totalDuration : p))
  }, [totalDuration])

  // Live mixer / master / volume-automation changes while playing.
  useEffect(() => {
    engineRef.current?.applyMix(project.tracks, gains)
  }, [gains, project.tracks])
  useEffect(() => {
    engineRef.current?.setMasterVolume(masterVolume)
  }, [masterVolume])

  // ---------- keyboard ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? history.redo() : history.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }
      switch (e.key) {
        case ' ':
          e.preventDefault()
          setIsPlaying((p) => !p)
          break
        case 'v':
        case 'V':
          setTool('select')
          break
        case 'b':
        case 'B':
          setTool('blade')
          break
        case 's':
        case 'S':
          splitAtPlayhead()
          break
        case 'm':
        case 'M':
          mergeSelected()
          break
        case 'Delete':
        case 'Backspace':
          deleteSelected(e.shiftKey)
          break
        case 'ArrowLeft':
          if (selectedClipId) {
            e.preventDefault()
            nudgeSelected(e.shiftKey ? -1 : -0.1)
          }
          break
        case 'ArrowRight':
          if (selectedClipId) {
            e.preventDefault()
            nudgeSelected(e.shiftKey ? 1 : 0.1)
          }
          break
        case 'Home':
          seek(0)
          break
        case 'End':
          seek(totalDuration)
          break
        case 'l':
        case 'L':
          setLoop((v) => !v)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history, splitAtPlayhead, mergeSelected, deleteSelected, duplicateSelected, nudgeSelected, seek, selectedClipId, totalDuration])

  // ---------- derived: video frame + csv readout ----------
  const videoClip = project.clips.find((c) => {
    const src = sources[c.sourceId]
    return src?.kind === 'video' && playhead >= c.start && playhead <= c.start + c.duration
  })
  const videoCovered = !!videoClip
  let videoUrl: string | undefined
  let videoTime: number | null = null
  if (videoClip) {
    videoUrl = sources[videoClip.sourceId]?.mediaUrl
    videoTime = videoClip.inPoint + (playhead - videoClip.start)
  } else {
    // Keep an element mounted (avoids reload flicker) but the preview shows black —
    // there is no video at this playhead position.
    videoUrl = Object.values(sources).find((s) => s.kind === 'video' && s.mediaUrl)?.mediaUrl
  }

  const onTimelineSourceIds = new Set(project.clips.map((c) => c.sourceId))

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null
  const selectedSource = selectedClip ? sources[selectedClip.sourceId] ?? null : null
  let csvReadout: { name: string; value: number | null }[] | null = null
  let csvEnvGain: number | null = null // envelope × fade factor applied at the playhead (null = none)
  if (selectedClip && selectedSource?.csv) {
    const t = playhead - selectedClip.start + selectedClip.inPoint
    if (t >= selectedClip.inPoint - 1e-6 && t <= selectedClip.inPoint + selectedClip.duration + 1e-6) {
      // Show the OUTPUT value — data × track envelope × clip fades — exactly what the CSV export
      // writes. (The raw source value alone reads wrong whenever an envelope is active.)
      const track = project.tracks.find((tr) => tr.id === selectedClip.trackId)
      const local = playhead - selectedClip.start
      let fade = 1
      if (selectedClip.fadeIn && selectedClip.fadeIn > 0 && local < selectedClip.fadeIn) fade = Math.min(fade, local / selectedClip.fadeIn)
      if (selectedClip.fadeOut && selectedClip.fadeOut > 0 && local > selectedClip.duration - selectedClip.fadeOut)
        fade = Math.min(fade, (selectedClip.duration - local) / selectedClip.fadeOut)
      fade = Math.max(0, Math.min(1, fade))
      const g = intensityAt(track?.intensity, playhead) * fade
      csvEnvGain = track?.intensity?.length || fade < 1 ? g : null
      csvReadout = selectedSource.csv.series.map((s) => {
        const raw = sampleSeries(s, t)
        return { name: s.name, value: raw == null ? null : raw * g }
      })
    }
  }

  return (
    <div className="app">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,audio/*,.csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          importFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".experium,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.[0]) openProjectFile(e.target.files[0])
          e.target.value = ''
        }}
      />
      <input
        ref={relinkInput}
        type="file"
        accept="video/*,audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && relinkTargetId.current) relinkSource(relinkTargetId.current, f)
          relinkTargetId.current = null
          e.target.value = ''
        }}
      />
      <input
        ref={relinkAllInput}
        type="file"
        accept="video/*,audio/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) relinkAll(e.target.files)
          e.target.value = ''
        }}
      />
      <TopBar
        busy={busy}
        saveStatus={saveStatus}
        onImport={() => fileInput.current?.click()}
        onExport={() => setExportOpen(true)}
        onSaveProject={saveProjectFile}
        onOpenProject={() => projectInput.current?.click()}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />
      <div className="app__body">
        <LibraryPanel
          width={mediaWidth}
          rawData={rawData}
          librarySources={Object.values(sources)}
          onTimelineSourceIds={onTimelineSourceIds}
          processingId={processingId}
          onImport={() => fileInput.current?.click()}
          onImportFiles={importFiles}
          onNewCarrier={newCarrier}
          onProcess={processRaw}
          onProcessAll={processAllRaw}
          onRemoveRaw={removeRaw}
          onRemoveSource={removeSource}
          onRelink={onRelink}
          onRelinkAll={onRelinkAll}
          onDragSourceStart={setDraggingKind}
          onDragSourceEnd={() => setDraggingKind(null)}
        />
        <ResizeHandle axis="x" onDelta={(d) => setMediaWidth((w) => clamp(w + d, 180, 480))} />
        <main className="app__center">
          <Preview
            videoUrl={videoUrl}
            videoCovered={videoCovered}
            videoTime={videoTime}
            isPlaying={isPlaying}
            loop={loop}
            masterVolume={masterVolume}
            playhead={playhead}
            totalDuration={totalDuration}
            frameRate={frameRate}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSeek={seek}
            onToggleLoop={() => setLoop((v) => !v)}
            onMasterVolume={setMasterVolume}
            onFrameRate={setFrameRate}
          />
          <ResizeHandle axis="y" onDelta={(d) => setTimelineHeight((h) => clamp(h - d, 160, 600))} />
          <div className="timeline-wrap" style={{ height: timelineHeight }}>
            <Timeline
              project={project}
              sourcesById={sources}
              mixer={mixer}
              getMix={getMix}
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              trackHeight={trackHeight}
              ampScale={ampScale}
              playhead={playhead}
              tool={tool}
              snapEnabled={snap}
              selectedClipId={selectedClipId}
              setPixelsPerSecond={setPixelsPerSecond}
              setTrackHeight={setTrackHeight}
              setAmpScale={setAmpScale}
              setTool={setTool}
              setSnap={setSnap}
              onSelectClip={setSelectedClipId}
              onScrub={(t) => setPlayhead(Math.max(0, Math.min(t, totalDuration)))}
              onSeek={seek}
              onSetTrackMix={setTrackMix}
              onAddTrack={addTrack}
              maxPerKind={MAX_PER_KIND}
              draggingKind={draggingKind}
              onDropSource={dropSourceOnTrack}
              onRenameTrack={renameTrack}
              onRemoveTrack={removeTrack}
              onSplitAt={splitClipAt}
              onSplitAtPlayhead={splitAtPlayhead}
              onMergeSelected={mergeSelected}
              onDeleteSelected={() => deleteSelected(false)}
              onDuplicate={duplicateSelected}
              onFit={fit}
              beginGesture={history.beginGesture}
              endGesture={history.endGesture}
              liveProject={history.live}
            />
          </div>
        </main>
        <ResizeHandle axis="x" onDelta={(d) => setInspectorWidth((w) => clamp(w - d, 200, 480))} />
        <Inspector width={inspectorWidth} clip={selectedClip} source={selectedSource} csvReadout={csvReadout} csvEnvGain={csvEnvGain} playhead={playhead} />
      </div>
      {exportOpen && (
        <ExportDialog
          hasAudio={project.clips.some((c) => sources[c.sourceId]?.audioBuffer)}
          hasCsv={project.clips.some((c) => sources[c.sourceId]?.csv)}
          hasVideo={project.clips.some((c) => sources[c.sourceId]?.kind === 'video')}
          exportLength={exportLength}
          csvTracks={csvTrackInfo}
          audioTracks={audioTrackInfo}
          onExportWav={exportWav}
          onExportCsv={exportCsv}
          onExportVideo={exportVideo}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
