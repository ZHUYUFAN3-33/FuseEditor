import { useState } from 'react'

interface Props {
  hasAudio: boolean
  hasCsv: boolean
  hasVideo: boolean
  onExportWav: () => Promise<void>
  onExportCsv: () => Promise<void>
  onExportVideo: (onProgress: (p: number) => void) => Promise<void>
  onClose: () => void
}

type Status = { kind: 'idle' | 'running' | 'done' | 'error'; msg?: string; progress?: number }

export default function ExportDialog({ hasAudio, hasCsv, hasVideo, onExportWav, onExportCsv, onExportVideo, onClose }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const running = status.kind === 'running'

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

        <button className="export__opt" disabled={running || !hasAudio} onClick={() => run('Audio mixdown (.wav)', onExportWav)}>
          <span className="export__icon">🎵</span>
          <span>
            <b>Audio mixdown — WAV</b>
            <small>Exact offline render of all audio tracks (mute / solo / volume applied)</small>
          </span>
        </button>

        <button className="export__opt" disabled={running || !hasCsv} onClick={() => run('Time-series (.csv)', onExportCsv)}>
          <span className="export__icon">📈</span>
          <span>
            <b>Time series — CSV</b>
            <small>All CSV tracks, re-aligned to the timeline after your edits</small>
          </span>
        </button>

        <button
          className="export__opt"
          disabled={running || !hasVideo}
          onClick={() => run('Video (.webm)', () => onExportVideo((p) => setStatus({ kind: 'running', msg: 'Recording video (.webm)', progress: p })))}
        >
          <span className="export__icon">🎬</span>
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
