import type { Clip as ClipT, MediaSource } from '../types'
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
  tool: Tool
  selected: boolean
  locked: boolean
  onSelect: (id: string) => void
  onBladeSplit: (id: string, offsetSec: number) => void
  onBodyDown: (id: string, e: React.PointerEvent) => void
  onTrimDown: (id: string, edge: 'l' | 'r', e: React.PointerEvent) => void
}

export default function Clip({
  clip,
  source,
  color,
  pixelsPerSecond,
  height,
  ampScale,
  tool,
  selected,
  locked,
  onSelect,
  onBladeSplit,
  onBodyDown,
  onTrimDown,
}: Props) {
  const left = clip.start * pixelsPerSecond
  const width = Math.max(2, clip.duration * pixelsPerSecond)
  const vizHeight = height - 8 - 14 // clip padding + label row

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
          />
        )}
        {!source.waveform && !source.csv && source.kind === 'video' && (
          <div className="clip__novideo">video</div>
        )}
      </div>

      {tool === 'select' && !locked && (
        <>
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
