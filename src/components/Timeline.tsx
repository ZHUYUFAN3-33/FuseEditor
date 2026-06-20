import { useEffect, useRef } from 'react'
import type { Clip as ClipT, MediaSource, Project, TrackMix } from '../types'
import type { Tool } from './Clip'
import Clip from './Clip'
import { middleEllipsis, fmtTime } from '../lib/format'

const HEAD_WIDTH = 184
const SNAP_PX = 8
const MIN_DUR = 0.05

interface Props {
  project: Project
  sourcesById: Record<string, MediaSource>
  mixer: Record<string, TrackMix>
  getMix: (trackId: string) => TrackMix
  totalDuration: number
  pixelsPerSecond: number
  trackHeight: number
  ampScale: number
  playhead: number
  tool: Tool
  snapEnabled: boolean
  selectedClipId: string | null
  setPixelsPerSecond: (v: number) => void
  setTrackHeight: (v: number) => void
  setAmpScale: (v: number) => void
  setTool: (t: Tool) => void
  setSnap: (v: boolean) => void
  onSelectClip: (id: string | null) => void
  onScrub: (t: number) => void
  onSeek: (t: number) => void
  onSetTrackMix: (trackId: string, patch: Partial<TrackMix>) => void
  onAddAudioTrack: () => void
  onRemoveTrack: (id: string) => void
  onSplitAt: (clipId: string, offsetSec: number) => void
  onSplitAtPlayhead: () => void
  onMergeSelected: () => void
  onDeleteSelected: () => void
  onDuplicate: () => void
  onFit: (viewportWidth: number) => void
  beginGesture: () => void
  endGesture: () => void
  liveProject: (p: Project) => void
}

function rulerStep(pps: number): number {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300]
  for (const s of candidates) if (s * pps >= 64) return s
  return 600
}

export default function Timeline(props: Props) {
  const {
    project,
    sourcesById,
    getMix,
    totalDuration,
    pixelsPerSecond: pps,
    trackHeight,
    ampScale,
    playhead,
    tool,
    snapEnabled,
    selectedClipId,
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<null | { kind: 'move' | 'trim-l' | 'trim-r'; base: ClipT; startX: number; snaps: number[] }>(null)
  const scrub = useRef<null | { rectLeft: number }>(null)

  const contentWidth = totalDuration * pps
  const step = rulerStep(pps)
  const marks: number[] = []
  for (let s = 0; s <= totalDuration; s += step) marks.push(s)

  // auto-scroll to keep the playhead visible while playing
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = HEAD_WIDTH + playhead * pps
    if (x < el.scrollLeft + HEAD_WIDTH || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.5)
    }
  }, [playhead, pps])

  // ---- snapping ----
  function snapTimes(excludeClipId: string): number[] {
    const out: number[] = [0, playhead]
    for (const c of project.clips) {
      if (c.id === excludeClipId) continue
      out.push(c.start, c.start + c.duration)
    }
    return out
  }
  function snap(t: number, snaps: number[]): number {
    if (!snapEnabled) return t
    const thr = SNAP_PX / pps
    let best = t
    let bestD = thr
    for (const s of snaps) {
      const d = Math.abs(s - t)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  function updateClip(id: string, patch: Partial<ClipT>): Project {
    return { ...project, clips: project.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
  }

  // ---- clip gestures ----
  function onBodyDown(id: string, e: React.PointerEvent) {
    const clip = project.clips.find((c) => c.id === id)
    if (!clip) return
    props.onSelectClip(id)
    props.beginGesture()
    gesture.current = { kind: 'move', base: clip, startX: e.clientX, snaps: snapTimes(id) }
    addWindowListeners()
  }
  function onTrimDown(id: string, edge: 'l' | 'r', e: React.PointerEvent) {
    const clip = project.clips.find((c) => c.id === id)
    if (!clip) return
    props.onSelectClip(id)
    props.beginGesture()
    gesture.current = { kind: edge === 'l' ? 'trim-l' : 'trim-r', base: clip, startX: e.clientX, snaps: snapTimes(id) }
    addWindowListeners()
  }
  function addWindowListeners() {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }
  function onPointerMove(e: PointerEvent) {
    const g = gesture.current
    if (!g) return
    const dx = (e.clientX - g.startX) / pps
    const srcDur = sourcesById[g.base.sourceId]?.fullDuration ?? g.base.inPoint + g.base.duration

    if (g.kind === 'move') {
      let ns = Math.max(0, g.base.start + dx)
      const sl = snap(ns, g.snaps)
      const sr = snap(ns + g.base.duration, g.snaps) - g.base.duration
      ns = Math.abs(sl - ns) <= Math.abs(sr - ns) ? sl : Math.max(0, sr)

      let trackId = g.base.trackId
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const laneEl = under?.closest('[data-track-id]') as HTMLElement | null
      if (laneEl) {
        const tid = laneEl.dataset.trackId!
        const tk = project.tracks.find((t) => t.id === tid)
        const myKind = project.tracks.find((t) => t.id === g.base.trackId)?.kind
        if (tk && tk.kind === myKind && !getMix(tid).locked) trackId = tid
      }
      props.liveProject(updateClip(g.base.id, { start: ns, trackId }))
    } else if (g.kind === 'trim-l') {
      let newStart = snap(g.base.start + dx, g.snaps)
      const minStart = g.base.start - g.base.inPoint
      newStart = Math.min(g.base.start + g.base.duration - MIN_DUR, Math.max(Math.max(0, minStart), newStart))
      const d = newStart - g.base.start
      props.liveProject(updateClip(g.base.id, { start: newStart, inPoint: g.base.inPoint + d, duration: g.base.duration - d }))
    } else {
      let newEnd = snap(g.base.start + g.base.duration + dx, g.snaps)
      newEnd = Math.min(g.base.start + (srcDur - g.base.inPoint), Math.max(g.base.start + MIN_DUR, newEnd))
      props.liveProject(updateClip(g.base.id, { duration: newEnd - g.base.start }))
    }
  }
  function onPointerUp() {
    gesture.current = null
    window.removeEventListener('pointermove', onPointerMove)
    props.endGesture()
  }

  // ---- ruler scrubbing (click + drag) ----
  function timeFromClientX(clientX: number, rectLeft: number) {
    return Math.max(0, (clientX - rectLeft) / pps)
  }
  function onRulerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rectLeft = e.currentTarget.getBoundingClientRect().left
    scrub.current = { rectLeft }
    props.onScrub(timeFromClientX(e.clientX, rectLeft))
    const move = (ev: PointerEvent) => scrub.current && props.onScrub(timeFromClientX(ev.clientX, scrub.current.rectLeft))
    const up = (ev: PointerEvent) => {
      if (scrub.current) props.onSeek(timeFromClientX(ev.clientX, scrub.current.rectLeft))
      scrub.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- wheel zoom (ctrl/⌘ + wheel), keeping the time under the cursor fixed ----
  function onWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const el = scrollRef.current
    if (!el) return
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newPps = Math.min(300, Math.max(6, pps * factor))
    const cursorX = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD_WIDTH
    const timeAtCursor = cursorX / pps
    props.setPixelsPerSecond(newPps)
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = timeAtCursor * newPps + HEAD_WIDTH - (e.clientX - el.getBoundingClientRect().left)
      }
    })
  }

  return (
    <section className="timeline panel">
      <div className="timeline__toolbar">
        <div className="toolgroup">
          <button className={'tool' + (tool === 'select' ? ' tool--on' : '')} title="Select / move / trim (V)" onClick={() => props.setTool('select')}>
            ↖
          </button>
          <button className={'tool' + (tool === 'blade' ? ' tool--on' : '')} title="Blade — click a clip to split (B)" onClick={() => props.setTool('blade')}>
            ✂
          </button>
        </div>
        <div className="toolgroup">
          <button className="tool" title="Split at playhead (S)" onClick={props.onSplitAtPlayhead}>
            ⎶
          </button>
          <button className="tool" title="Merge with next clip (M)" disabled={!selectedClipId} onClick={props.onMergeSelected}>
            🔗
          </button>
          <button className="tool" title="Duplicate (⌘D)" disabled={!selectedClipId} onClick={props.onDuplicate}>
            ⎘
          </button>
          <button className="tool" title="Delete (⌫ · ⇧⌫ ripple)" disabled={!selectedClipId} onClick={props.onDeleteSelected}>
            🗑
          </button>
        </div>
        <button className="tool" onClick={props.onAddAudioTrack}>
          ＋ Audio
        </button>
        <button className={'tool' + (snapEnabled ? ' tool--on' : '')} title="Snapping" onClick={() => props.setSnap(!snapEnabled)}>
          🧲
        </button>
        <button className="tool" title="Zoom to fit" onClick={() => props.onFit((scrollRef.current?.clientWidth ?? 800) - HEAD_WIDTH)}>
          ⤢
        </button>

        <div className="timeline__spacer" />

        <label className="zoom">
          ↔
          <input type="range" min={6} max={300} value={pps} onChange={(e) => props.setPixelsPerSecond(Number(e.target.value))} />
          <span className="zoom__val">{Math.round(pps)}px/s</span>
        </label>
        <label className="zoom">
          ↕
          <input type="range" min={44} max={220} value={trackHeight} onChange={(e) => props.setTrackHeight(Number(e.target.value))} />
        </label>
        <label className="zoom">
          ◎
          <input type="range" min={0.2} max={4} step={0.1} value={ampScale} onChange={(e) => props.setAmpScale(Number(e.target.value))} />
          <span className="zoom__val">{ampScale.toFixed(1)}×</span>
        </label>
      </div>

      <div className="timeline__scroll" ref={scrollRef} onWheel={onWheel}>
        <div className="timeline__inner" style={{ width: HEAD_WIDTH + contentWidth }}>
          <div className="timeline__ruler">
            <div className="timeline__gutter" style={{ width: HEAD_WIDTH }} />
            <div className="timeline__rulermarks" style={{ width: contentWidth }} onPointerDown={onRulerDown}>
              {marks.map((s) => (
                <span key={s} className="timeline__mark" style={{ left: s * pps }}>
                  {fmtTime(s)}
                </span>
              ))}
            </div>
          </div>

          {project.tracks.length === 0 && <div className="timeline__empty">Import a video / audio / CSV file, or add an audio track.</div>}

          {project.tracks.map((track) => {
            const clips = project.clips.filter((c) => c.trackId === track.id)
            const mix = getMix(track.id)
            const hasAudio = track.kind !== 'csv'
            return (
              <div className="track" key={track.id} style={{ height: trackHeight }}>
                <div className="track__head" style={{ width: HEAD_WIDTH }}>
                  <div className="track__headtop">
                    <span className="track__icon">{track.kind === 'video' ? '🎬' : track.kind === 'audio' ? '🎵' : '📈'}</span>
                    <span className="track__name" title={track.name}>
                      {middleEllipsis(track.name, 16)}
                    </span>
                    <button className="track__remove" title="Remove track" onClick={() => props.onRemoveTrack(track.id)}>
                      ✕
                    </button>
                  </div>
                  <div className="track__ctrls">
                    {hasAudio && (
                      <>
                        <button className={'tbtn' + (mix.muted ? ' tbtn--on' : '')} title="Mute" onClick={() => props.onSetTrackMix(track.id, { muted: !mix.muted })}>
                          {mix.muted ? '🔇' : '🔈'}
                        </button>
                        <button className={'tbtn' + (mix.solo ? ' tbtn--solo' : '')} title="Solo" onClick={() => props.onSetTrackMix(track.id, { solo: !mix.solo })}>
                          S
                        </button>
                        <input className="tvol" type="range" min={0} max={1} step={0.01} value={mix.volume} title="Volume" onChange={(e) => props.onSetTrackMix(track.id, { volume: Number(e.target.value) })} />
                      </>
                    )}
                    <button className={'tbtn' + (mix.locked ? ' tbtn--on' : '')} title="Lock" onClick={() => props.onSetTrackMix(track.id, { locked: !mix.locked })}>
                      {mix.locked ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>
                <div
                  className="track__lane"
                  data-track-id={track.id}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) props.onSelectClip(null)
                  }}
                >
                  {clips.map((clip) => {
                    const src = sourcesById[clip.sourceId]
                    if (!src) return null
                    return (
                      <Clip
                        key={clip.id}
                        clip={clip}
                        source={src}
                        color={track.color}
                        pixelsPerSecond={pps}
                        height={trackHeight}
                        ampScale={ampScale}
                        tool={tool}
                        selected={selectedClipId === clip.id}
                        locked={mix.locked}
                        onSelect={props.onSelectClip}
                        onBladeSplit={props.onSplitAt}
                        onBodyDown={onBodyDown}
                        onTrimDown={onTrimDown}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div className="timeline__playhead" style={{ left: HEAD_WIDTH + playhead * pps }} />
        </div>
      </div>
    </section>
  )
}
