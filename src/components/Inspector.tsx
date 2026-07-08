import type { Clip, MediaSource } from '../types'
import { fmtTime } from '../lib/format'

interface Props {
  width: number
  clip: Clip | null
  source: MediaSource | null
  csvReadout: { name: string; value: number | null }[] | null
  csvEnvGain: number | null // envelope × fade multiplier at the playhead (null = nothing applied)
  playhead: number
}

const KIND_LABEL: Record<MediaSource['kind'], string> = {
  video: 'Video',
  audio: 'Audio',
  csv: 'CSV / time series',
}

export default function Inspector({ width, clip, source, csvReadout, csvEnvGain, playhead }: Props) {
  return (
    <aside className="inspector panel" style={{ width, flexShrink: 0 }}>
      <div className="panel__header">Inspector</div>
      {clip && source ? (
        <div className="inspector__body">
          <p className="inspector__label">{KIND_LABEL[source.kind]} clip</p>
          <p className="inspector__value inspector__value--wrap">{clip.name}</p>

          <div className="inspector__grid">
            <div className="inspector__field">
              <label>Start</label>
              <input readOnly value={`${clip.start.toFixed(2)}s`} />
            </div>
            <div className="inspector__field">
              <label>Duration</label>
              <input readOnly value={`${clip.duration.toFixed(2)}s`} />
            </div>
            <div className="inspector__field">
              <label>In</label>
              <input readOnly value={`${clip.inPoint.toFixed(2)}s`} />
            </div>
            <div className="inspector__field">
              <label>Out</label>
              <input readOnly value={`${(clip.inPoint + clip.duration).toFixed(2)}s`} />
            </div>
          </div>

          {csvReadout && (
            <div className="inspector__meta">
              <p className="inspector__label" title="Data × track envelope × clip fades — exactly what the exported CSV contains">
                Output @ playhead
              </p>
              {csvEnvGain != null && (
                <p className="inspector__small inspector__envnote">
                  ◆ envelope ×{csvEnvGain.toFixed(2)} applied — open the track's ◆ lane to edit / clear it
                </p>
              )}
              <ul className="inspector__serieslist">
                {csvReadout.map((r) => (
                  <li key={r.name}>
                    <span>{r.name}</span>
                    <span className="inspector__range">{r.value == null ? '—' : r.value.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {source.csv && !csvReadout && (
            <p className="inspector__small">Move the playhead over this clip to read values.</p>
          )}

          {source.waveform && (
            <div className="inspector__meta">
              <p className="inspector__label">Waveform</p>
              <p className="inspector__small">{source.waveform.peaks.length} samples · {source.fullDuration.toFixed(1)}s source</p>
            </div>
          )}
        </div>
      ) : (
        <div className="inspector__empty">Select a clip to edit its properties</div>
      )}
      <div className="inspector__footer">Playhead: {fmtTime(playhead, true)}</div>
    </aside>
  )
}
