import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import MediaBin from './components/MediaBin'
import Preview from './components/Preview'
import Inspector from './components/Inspector'
import Timeline from './components/Timeline'
import ResizeHandle from './components/ResizeHandle'
import ExportDialog from './components/ExportDialog'
import type { Tool } from './components/Clip'
import type { Clip, GainMap, MediaSource, Project, Series, Track, TrackKind, TrackMix } from './types'
import { decodeAudio, getMediaDuration } from './lib/audio'
import { parseCsv } from './lib/csv'
import { useHistory } from './lib/history'
import { AudioEngine } from './lib/engine'
import { buildTimelineCsv, downloadBlob, downloadText, renderTimelineToWav } from './lib/export'
import './styles/app.css'

let _seq = 0
const id = (p: string) => `${p}_${++_seq}`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MIN_DUR = 0.05
const DEFAULT_MIX: TrackMix = { muted: false, solo: false, volume: 1, locked: false }

const COLORS: Record<TrackKind, string> = { video: '#4f7cff', audio: '#2dbd8f', csv: '#e0913a' }

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
  const history = useHistory<Project>({ tracks: [], clips: [] })
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [masterVolume, setMasterVolume] = useState(1)
  const [busy, setBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

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

  // ---------- import ----------
  const importFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      setBusy(true)
      const addedSources: Record<string, MediaSource> = {}
      const addedTracks: Track[] = []
      const addedClips: Clip[] = []
      try {
        for (const file of Array.from(fileList)) {
          const kind = detectKind(file)
          if (!kind) continue

          if (kind === 'video') {
            const url = URL.createObjectURL(file)
            const dur = (await getMediaDuration(url, 'video')) || 0
            let decoded
            try {
              decoded = await decodeAudio(file)
            } catch {
              /* no decodable audio */
            }
            const realDur = dur || decoded?.waveform.duration || 0
            const vSrc: MediaSource = { id: id('src'), kind: 'video', name: file.name, fullDuration: realDur, mediaUrl: url }
            addedSources[vSrc.id] = vSrc
            const vTrack: Track = { id: id('trk'), kind: 'video', name: file.name, color: COLORS.video }
            addedTracks.push(vTrack)
            addedClips.push({ id: id('clp'), sourceId: vSrc.id, trackId: vTrack.id, name: file.name, start: 0, inPoint: 0, duration: realDur })

            if (decoded) {
              const aSrc: MediaSource = { id: id('src'), kind: 'audio', name: `${file.name} · audio`, fullDuration: decoded.waveform.duration, waveform: decoded.waveform, audioBuffer: decoded.audioBuffer }
              addedSources[aSrc.id] = aSrc
              const aTrack: Track = { id: id('trk'), kind: 'audio', name: `${file.name} · audio`, color: COLORS.audio }
              addedTracks.push(aTrack)
              addedClips.push({ id: id('clp'), sourceId: aSrc.id, trackId: aTrack.id, name: aSrc.name, start: 0, inPoint: 0, duration: decoded.waveform.duration })
            }
          } else if (kind === 'audio') {
            const { audioBuffer, waveform } = await decodeAudio(file)
            const src: MediaSource = { id: id('src'), kind: 'audio', name: file.name, fullDuration: waveform.duration, waveform, audioBuffer }
            addedSources[src.id] = src
            const trk: Track = { id: id('trk'), kind: 'audio', name: file.name, color: COLORS.audio }
            addedTracks.push(trk)
            addedClips.push({ id: id('clp'), sourceId: src.id, trackId: trk.id, name: file.name, start: 0, inPoint: 0, duration: waveform.duration })
          } else {
            const csv = parseCsv(await file.text())
            const dur = csv.duration || 30
            const src: MediaSource = { id: id('src'), kind: 'csv', name: file.name, fullDuration: dur, csv }
            addedSources[src.id] = src
            const trk: Track = { id: id('trk'), kind: 'csv', name: file.name, color: COLORS.csv }
            addedTracks.push(trk)
            addedClips.push({ id: id('clp'), sourceId: src.id, trackId: trk.id, name: file.name, start: 0, inPoint: 0, duration: dur })
          }
        }
        if (addedTracks.length) {
          setSources((prev) => ({ ...prev, ...addedSources }))
          history.commit({ tracks: [...project.tracks, ...addedTracks], clips: [...project.clips, ...addedClips] })
        }
      } finally {
        setBusy(false)
      }
    },
    [history, project.tracks, project.clips],
  )

  // ---------- mixer ----------
  const getMix = useCallback((trackId: string): TrackMix => mixer[trackId] ?? DEFAULT_MIX, [mixer])
  const setTrackMix = useCallback(
    (trackId: string, patch: Partial<TrackMix>) =>
      setMixer((m) => ({ ...m, [trackId]: { ...(m[trackId] ?? DEFAULT_MIX), ...patch } })),
    [],
  )

  // ---------- discrete edit actions ----------
  const addAudioTrack = useCallback(() => {
    const n = project.tracks.filter((t) => t.kind === 'audio').length + 1
    history.commit({ ...project, tracks: [...project.tracks, { id: id('trk'), kind: 'audio', name: `Audio ${n}`, color: COLORS.audio }] })
  }, [history, project])

  const removeTrack = useCallback(
    (trackId: string) => {
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
  const exportWav = useCallback(async () => {
    const blob = await renderTimelineToWav(project, sources, gains, masterVolume, totalDuration)
    downloadBlob(blob, 'experium-mix.wav')
  }, [project, sources, gains, masterVolume, totalDuration])

  const exportCsv = useCallback(async () => {
    const text = buildTimelineCsv(project, sources)
    if (!text) throw new Error('No CSV tracks to export')
    downloadText(text, 'experium-timeseries.csv')
  }, [project, sources])

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
          if (t >= totalDuration) {
            resolve()
            return
          }
          onProgress(Math.min(1, t / totalDuration))
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
    [project, sources, gains, masterVolume, totalDuration],
  )

  // ---------- transport ----------
  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, t)
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
    engine.play(ref.playhead.current, ref.project.current, ref.sources.current, ref.gains.current, ref.master.current)
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
      } else setPlayhead(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      engine.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Live mixer / master changes while playing.
  useEffect(() => {
    engineRef.current?.applyTrackGains(gains)
  }, [gains])
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
  let videoUrl: string | undefined
  let videoTime: number | null = null
  if (videoClip) {
    videoUrl = sources[videoClip.sourceId]?.mediaUrl
    videoTime = videoClip.inPoint + (playhead - videoClip.start)
  } else {
    videoUrl = Object.values(sources).find((s) => s.kind === 'video' && s.mediaUrl)?.mediaUrl
  }

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null
  const selectedSource = selectedClip ? sources[selectedClip.sourceId] ?? null : null
  let csvReadout: { name: string; value: number | null }[] | null = null
  if (selectedClip && selectedSource?.csv) {
    const t = playhead - selectedClip.start + selectedClip.inPoint
    if (t >= selectedClip.inPoint - 1e-6 && t <= selectedClip.inPoint + selectedClip.duration + 1e-6) {
      csvReadout = selectedSource.csv.series.map((s) => ({ name: s.name, value: sampleSeries(s, t) }))
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
      <TopBar busy={busy} onImport={() => fileInput.current?.click()} onExport={() => setExportOpen(true)} onUndo={history.undo} onRedo={history.redo} canUndo={history.canUndo} canRedo={history.canRedo} />
      <div className="app__body">
        <MediaBin width={mediaWidth} sources={Object.values(sources)} onImport={() => fileInput.current?.click()} onImportFiles={importFiles} />
        <ResizeHandle axis="x" onDelta={(d) => setMediaWidth((w) => clamp(w + d, 180, 480))} />
        <main className="app__center">
          <Preview
            videoUrl={videoUrl}
            videoTime={videoTime}
            isPlaying={isPlaying}
            loop={loop}
            masterVolume={masterVolume}
            playhead={playhead}
            totalDuration={totalDuration}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSeek={seek}
            onToggleLoop={() => setLoop((v) => !v)}
            onMasterVolume={setMasterVolume}
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
              onScrub={setPlayhead}
              onSeek={seek}
              onSetTrackMix={setTrackMix}
              onAddAudioTrack={addAudioTrack}
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
        <Inspector width={inspectorWidth} clip={selectedClip} source={selectedSource} csvReadout={csvReadout} playhead={playhead} />
      </div>
      {exportOpen && (
        <ExportDialog
          hasAudio={project.clips.some((c) => sources[c.sourceId]?.audioBuffer)}
          hasCsv={project.clips.some((c) => sources[c.sourceId]?.csv)}
          hasVideo={project.clips.some((c) => sources[c.sourceId]?.kind === 'video')}
          onExportWav={exportWav}
          onExportCsv={exportCsv}
          onExportVideo={exportVideo}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
