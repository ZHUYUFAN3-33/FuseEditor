import type { Clip as ClipT, Keyframe, MediaSource } from '../types'
import { middleEllipsis } from '../lib/format'
import WaveformCanvas from './WaveformCanvas'
import SeriesCanvas from './SeriesCanvas'

export type Tool = 'select' | 'blade'

interface Props {
  clip: ClipT
  source: MediaSource
  color: string
  pixelsPerSecond: number
  height: number
  ampScale: number
  automation?: Keyframe[]
  tool: Tool
  selected: boolean
  locked: boolean
  onSelect: (id: string) => void
  onBladeSplit: (id: string, offsetSec: number) => void
  onBodyDown: (id: string, e: React.PointerEvent) => void
  onTrimDown: (id: string, edge: 'l' | 'r', e: React.PointerEvent) => void
  onFadeDown: (id: string, edge: 'l' | 'r', e: React.PointerEvent) => void
}

export default function Clip({
  clip,
  source,
  color,
  pixelsPerSecond,
  height,
  ampScale,
  automation,
  tool,
  selected,
  locked,
  onSelect,
  onBladeSplit,
  onBodyDown,
  onTrimDown,
  onFadeDown,
}: Props) {
  const left = clip.start * pixelsPerSecond
  const width = Math.max(2, clip.duration * pixelsPerSecond)
  const vizHeight = height - 8 - 14 // clip padding + label row
  const fadeInPx = (clip.fadeIn ?? 0) * pixelsPerSecond
  const fadeOutPx = (clip.fadeOut ?? 0) * pixelsPerSecond
  const editable = tool === 'select' && !locked

  function handlePointerDown(e: React.PointerEvent) {
    if (locked || tool === 'blade') return // locked = no move; blade handled on click
    onBodyDown(clip.id, e)
  }

  function handleClick(e: React.MouseEvent) {
    if (!locked && tool === 'blade') {
      onBladeSplit(clip.id, e.nativeEvent.offsetX / pixelsPerSecond)
      return
    }
    onSelect(clip.id)
  }

  return (
    <div
      className={
        'clip' +
        (selected ? ' clip--selected' : '') +
        (locked ? ' clip--locked' : tool === 'blade' ? ' clip--blade' : '')
      }
      style={{ left, width, borderColor: color }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      title={clip.name}
    >
      <div className="clip__label" style={{ background: color }}>
        {middleEllipsis(clip.name, Math.max(6, Math.floor(width / 7)))}
      </div>
      <div className="clip__viz">
        {source.waveform && (
          <WaveformCanvas
            peaks={source.waveform.peaks}
            startFrac={clip.inPoint / source.fullDuration}
            endFrac={(clip.inPoint + clip.duration) / source.fullDuration}
            width={width}
            height={vizHeight}
            color={color}
            ampScale={ampScale}
            automation={automation}
            clipStart={clip.start}
            clipDuration={clip.duration}
          />
        )}
        {source.csv && (
          <SeriesCanvas
            csv={source.csv}
            inPoint={clip.inPoint}
            duration={clip.duration}
            width={width}
            height={vizHeight}
            ampScale={ampScale}
            automation={automation}
            clipStart={clip.start}
          />
        )}
        {!source.waveform && !source.csv && source.kind === 'video' && (
          <div className="clip__novideo">video</div>
        )}
      </div>

      {/* fade-in / fade-out shapes (drawn from the top corners, DaVinci-style) */}
      {(fadeInPx > 0 || fadeOutPx > 0) && (
        <svg className="clip__fades" width={width} height={height - 8} preserveAspectRatio="none">
          {fadeInPx > 0 && <polygon points={`0,${height - 8} 0,0 ${fadeInPx},0`} />}
          {fadeOutPx > 0 && <polygon points={`${width},${height - 8} ${width},0 ${width - fadeOutPx},0`} />}
        </svg>
      )}

      {editable && (
        <>
          <div
            className="clip__fade clip__fade--l"
            style={{ left: Math.max(0, fadeInPx - 5) }}
            title="Drag to fade in"
            onPointerDown={(e) => {
              e.stopPropagation()
              onFadeDown(clip.id, 'l', e)
            }}
          />
          <div
            className="clip__fade clip__fade--r"
            style={{ right: Math.max(0, fadeOutPx - 5) }}
            title="Drag to fade out"
            onPointerDown={(e) => {
              e.stopPropagation()
              onFadeDown(clip.id, 'r', e)
            }}
          />
          <div
            className="clip__trim clip__trim--l"
            onPointerDown={(e) => {
              e.stopPropagation()
              onTrimDown(clip.id, 'l', e)
            }}
          />
          <div
            className="clip__trim clip__trim--r"
            onPointerDown={(e) => {
              e.stopPropagation()
              onTrimDown(clip.id, 'r', e)
            }}
          />
        </>
      )}
    </div>
  )
}
