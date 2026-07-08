import { useEffect, useRef } from 'react'
import { fmtTime } from '../lib/format'

interface Props {
  videoUrl?: string
  videoCovered: boolean
  videoTime: number | null
  isPlaying: boolean
  loop: boolean
  masterVolume: number
  playhead: number
  totalDuration: number
  frameRate: number
  onTogglePlay: () => void
  onSeek: (t: number) => void
  onToggleLoop: () => void
  onMasterVolume: (v: number) => void
  onFrameRate: (fps: number) => void
}

export default function Preview({
  videoUrl,
  videoCovered,
  videoTime,
  isPlaying,
  loop,
  masterVolume,
  playhead,
  totalDuration,
  frameRate,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onMasterVolume,
  onFrameRate,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null)

  // Keep the video frame in sync with the timeline playhead.
  useEffect(() => {
    const v = ref.current
    if (!v || videoTime == null) return
    if (Math.abs(v.currentTime - videoTime) > 0.35) v.currentTime = videoTime
  }, [videoTime])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (isPlaying) v.play().catch(() => {})
    else v.pause()
  }, [isPlaying, videoUrl])

  return (
    <section className="preview">
      <div className="preview__stage">
        {/* Keep the element mounted for smooth sync, but hide it where there is no
            video at the playhead — the preview must not lie about gaps. */}
        {videoUrl && (
          // muted: all audio (including this video's track) is mixed by the engine
          <video
            ref={ref}
            className="preview__video"
            src={videoUrl}
            muted
            style={{ display: videoCovered ? 'block' : 'none' }}
          />
        )}
        {(!videoUrl || !videoCovered) && (
          <div className="preview__placeholder">
            <span className="preview__icon">{videoUrl ? '▦' : '▶'}</span>
            <p>{videoUrl ? 'No video here' : 'Preview'}</p>
            <span className="preview__sub">{videoUrl ? 'playhead is in a gap' : 'import a video to preview it here'}</span>
          </div>
        )}
      </div>
      <div className="preview__transport">
        <button className="transport__btn" title="Go to start (Home)" onClick={() => onSeek(0)}>
          ⏮
        </button>
        <button
          className="transport__btn"
          title={`Previous frame (1/${frameRate} s)`}
          onClick={() => onSeek(Math.max(0, playhead - 1 / frameRate))}
        >
          ◁
        </button>
        <button className="transport__btn transport__btn--play" onClick={onTogglePlay} title="Play / Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="transport__btn"
          title={`Next frame (1/${frameRate} s)`}
          onClick={() => onSeek(Math.min(totalDuration, playhead + 1 / frameRate))}
        >
          ▷
        </button>
        <button className="transport__btn" title="Go to end (End)" onClick={() => onSeek(totalDuration)}>
          ⏭
        </button>
        <button className={'transport__btn' + (loop ? ' transport__btn--on' : '')} title="Loop (L)" onClick={onToggleLoop}>
          🔁
        </button>
        <div className="transport__vol" title="Master volume">
          🔊
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
      </div>
    </section>
  )
}
