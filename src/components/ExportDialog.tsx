import { useState } from 'react'
import { Activity, Film, Music } from 'lucide-react'

interface CsvTrack {
  id: string
  name: string
  channels: number
}
interface AudioTrack {
  id: string
  name: string
}

interface Props {
  hasAudio: boolean
  hasCsv: boolean
  hasVideo: boolean
  exportLength: number
  csvTracks: CsvTrack[]
  audioTracks: AudioTrack[]
  onExportWav: (trackIds: string[]) => Promise<void>
  onExportCsv: (sampleRate: number, trackIds: string[]) => Promise<void>
  onExportVideo: (onProgress: (p: number) => void) => Promise<void>
  onClose: () => void
}

type Status = { kind: 'idle' | 'running' | 'done' | 'error'; msg?: string; progress?: number }

export default function ExportDialog({ hasAudio, hasCsv, hasVideo, exportLength, csvTracks, audioTracks, onExportWav, onExportCsv, onExportVideo, onClose }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [csvRate, setCsvRate] = useState(60)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(csvTracks.map((t) => t.id)))
  const [pickedAudio, setPickedAudio] = useState<Set<string>>(() => new Set(audioTracks.map((t) => t.id)))
  const running = status.kind === 'running'
  const toggleIn = (setter: typeof setPicked) => (id: string) =>
    setter((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const toggle = toggleIn(setPicked)
  const toggleAudio = toggleIn(setPickedAudio)

  async function run(label: string, fn: () => Promise<void>) {
    setStatus({ kind: 'running', msg: label })
    try {
      await fn()
      setStatus({ kind: 'done', msg: `${label} ✓` })
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="modal__backdrop" onClick={running ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__title">Export</div>

        <button
          className="export__opt"
          disabled={running || !hasAudio || pickedAudio.size === 0}
          onClick={() => run('Audio (.wav)', () => onExportWav(Array.from(pickedAudio)))}
        >
          <span className="export__icon"><Music size={22} /></span>
          <span>
            <b>Audio — WAV <em>(one file per track)</em></b>
            <small>Each selected audio track → its own .wav, at the track's volume.</small>
          </span>
        </button>
        {hasAudio && (
          <div className="export__tracks">
            <div className="export__tracks-head">
              <span>Tracks ({pickedAudio.size}/{audioTracks.length})</span>
              <button className="export__all" disabled={running} onClick={() => setPickedAudio(new Set(audioTracks.map((t) => t.id)))}>
                All
              </button>
              <button className="export__all" disabled={running} onClick={() => setPickedAudio(new Set())}>
                None
              </button>
            </div>
            {audioTracks.map((t) => (
              <label key={t.id} className="export__track">
                <input type="checkbox" disabled={running} checked={pickedAudio.has(t.id)} onChange={() => toggleAudio(t.id)} />
                <span className="export__track-name">{t.name}</span>
              </label>
            ))}
          </div>
        )}

        <button
          className="export__opt"
          disabled={running || !hasCsv || picked.size === 0}
          onClick={() => run('Time-series (.csv)', () => onExportCsv(csvRate, Array.from(picked)))}
        >
          <span className="export__icon"><Activity size={22} /></span>
          <span>
            <b>Time series — CSV <em>(one file per track)</em></b>
            <small>
              Each track → its own .csv, {exportLength.toFixed(1)}s @ {csvRate}Hz ≈{' '}
              {Math.floor(exportLength * csvRate) + 1} rows. Gaps (no clip) = 0.
            </small>
          </span>
        </button>
        {hasCsv && (
          <div className="export__tracks">
            <div className="export__tracks-head">
              <span>Tracks ({picked.size}/{csvTracks.length})</span>
              <button className="export__all" disabled={running} onClick={() => setPicked(new Set(csvTracks.map((t) => t.id)))}>
                All
              </button>
              <button className="export__all" disabled={running} onClick={() => setPicked(new Set())}>
                None
              </button>
            </div>
            {csvTracks.map((t) => (
              <label key={t.id} className="export__track">
                <input type="checkbox" disabled={running} checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                <span className="export__track-name">{t.name}</span>
                <span className="export__track-ch">{t.channels} ch</span>
              </label>
            ))}
          </div>
        )}
        <div className="export__rate">
          <label>
            Sample rate
            <input
              type="number"
              min={1}
              max={1000}
              value={csvRate}
              disabled={running}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCsvRate(Math.max(1, Math.min(1000, Number(e.target.value) || 60)))}
            />
            Hz
          </label>
        </div>

        <button
          className="export__opt"
          disabled={running || !hasVideo}
          onClick={() => run('Video (.webm)', () => onExportVideo((p) => setStatus({ kind: 'running', msg: 'Recording video (.webm)', progress: p })))}
        >
          <span className="export__icon"><Film size={22} /></span>
          <span>
            <b>Video — WebM <em>(real-time · experimental)</em></b>
            <small>Records the preview + mixed audio in real time. mp4 needs ffmpeg (Electron) later.</small>
          </span>
        </button>

        <div className={'export__status export__status--' + status.kind}>
          {status.kind === 'idle' && 'Pick a format. Files download to your browser.'}
          {running && (
            <>
              {status.msg}
              {status.progress != null && <> — {Math.round(status.progress * 100)}%</>}
            </>
          )}
          {status.kind === 'done' && status.msg}
          {status.kind === 'error' && `Error: ${status.msg}`}
        </div>

        <div className="modal__actions">
          <button className="tool" disabled={running} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
