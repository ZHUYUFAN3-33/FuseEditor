import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, Radio, Repeat, SkipBack, SkipForward, Video, Volume2 } from 'lucide-react'
import { fmtTime } from '../lib/format'

export interface VideoLayerInfo {
  id: string
  url: string
  time: number // source time to show at the playhead
  name: string
}

interface Props {
  videoLayers: VideoLayerInfo[] // every video covering the playhead (for multi-video time alignment)
  isPlaying: boolean
  loop: boolean
  masterVolume: number
  playhead: number
  totalDuration: number
  frameRate: number
  liveTd: boolean
  tdUrl: string
  tdStatus: 'off' | 'connecting' | 'open' | 'error'
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onToggleLoop: () => void
  onMasterVolume: (v: number) => void
  onFrameRate: (fps: number) => void
  onToggleLiveTd: () => void
  onTdUrl: (url: string) => void
}

// One <video> that keeps its frame synced to the playhead. During playback it plays itself
// (only large drift is corrected); while scrubbing it seeks to the exact frame, coalescing
// seeks so rapid scrubbing stays responsive.
function VideoLayer({ url, time, isPlaying, label }: { url: string; time: number; isPlaying: boolean; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const pending = useRef<number | null>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (isPlaying) {
      if (Math.abs(v.currentTime - time) > 0.35) v.currentTime = time
      return
    }
    if (Math.abs(v.currentTime - time) < 0.001) return
    if (v.seeking) pending.current = time
    else {
      pending.current = null
      v.currentTime = time
    }
  }, [time, isPlaying])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const onSeeked = () => {
      const t = pending.current
      if (t != null) {
        pending.current = null
        if (Math.abs(v.currentTime - t) > 0.001) v.currentTime = t
      }
    }
    v.addEventListener('seeked', onSeeked)
    return () => v.removeEventListener('seeked', onSeeked)
  }, [url])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (isPlaying) v.play().catch(() => {})
    else v.pause()
  }, [isPlaying, url])

  return (
    <div className="preview__layer">
      <video ref={ref} className="preview__video" src={url} muted />
      {label && <span className="preview__layerlabel">{label}</span>}
    </div>
  )
}

export default function Preview({
  videoLayers,
  isPlaying,
  loop,
  masterVolume,
  playhead,
  totalDuration,
  frameRate,
  liveTd,
  tdUrl,
  tdStatus,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onMasterVolume,
  onFrameRate,
  onToggleLiveTd,
  onTdUrl,
}: Props) {
  return (
    <section className="preview">
      <div className={'preview__stage' + (videoLayers.length > 1 ? ' preview__stage--multi' : '')}>
        {videoLayers.length > 0 ? (
          <div className={'preview__grid preview__grid--' + Math.min(videoLayers.length, 4)}>
            {videoLayers.map((l) => (
              <VideoLayer key={l.id} url={l.url} time={l.time} isPlaying={isPlaying} label={videoLayers.length > 1 ? l.name : undefined} />
            ))}
          </div>
        ) : (
          <div className="preview__placeholder">
            <span className="preview__icon">
              <Video size={40} strokeWidth={1.5} />
            </span>
            <p>Preview</p>
            <span className="preview__sub">no video at the playhead</span>
          </div>
        )}
      </div>
      <div className="preview__transport">
        <button className="transport__btn" title="Go to start (Home)" onClick={() => onSeek(0)}>
          <SkipBack size={16} />
        </button>
        <button
          className="transport__btn"
          title={`Previous frame (1/${frameRate} s)`}
          onClick={() => onSeek(Math.max(0, playhead - 1 / frameRate))}
        >
          <ChevronLeft size={18} />
        </button>
        <button className="transport__btn transport__btn--play" onClick={onTogglePlay} title="Play / Pause (Space)">
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button
          className="transport__btn"
          title={`Next frame (1/${frameRate} s)`}
          onClick={() => onSeek(Math.min(totalDuration, playhead + 1 / frameRate))}
        >
          <ChevronRight size={18} />
        </button>
        <button className="transport__btn" title="Go to end (End)" onClick={() => onSeek(totalDuration)}>
          <SkipForward size={16} />
        </button>
        <button className={'transport__btn' + (loop ? ' transport__btn--on' : '')} title="Loop (L)" onClick={onToggleLoop}>
          <Repeat size={16} />
        </button>
        <div className="transport__vol" title="Master volume">
          <Volume2 size={16} />
          <input type="range" min={0} max={1} step={0.01} value={masterVolume} onChange={(e) => onMasterVolume(Number(e.target.value))} />
        </div>
        <span className="transport__time">
          {fmtTime(playhead, true)} / {fmtTime(totalDuration, true)}
        </span>
        <label className="transport__fps" title="Frame rate used by the ◁ ▷ step buttons (match your video)">
          <input
            type="number"
            min={1}
            max={240}
            value={frameRate}
            onChange={(e) => onFrameRate(Math.max(1, Math.min(240, Math.round(Number(e.target.value)) || 60)))}
          />
          fps
        </label>
        <div className="transport__td" title="Stream every frame's data × envelope to TouchDesigner over WebSocket">
          <button
            className={'transport__btn transport__td-btn transport__td-btn--' + tdStatus + (liveTd ? ' transport__btn--on' : '')}
            onClick={onToggleLiveTd}
            title={
              liveTd
                ? `Live → TD: ${tdStatus}. Click to stop.`
                : 'Start live streaming to TouchDesigner (WebSocket)'
            }
          >
            <Radio size={13} /> TD
          </button>
          {liveTd && (
            <input
              className="transport__td-url"
              value={tdUrl}
              spellCheck={false}
              onChange={(e) => onTdUrl(e.target.value)}
              title="TouchDesigner WebSocket DAT address (Server mode)"
            />
          )}
        </div>
      </div>
    </section>
  )
}
