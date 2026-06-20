import { useState } from 'react'
import type { MediaSource } from '../types'
import { middleEllipsis } from '../lib/format'

interface Props {
  width: number
  sources: MediaSource[]
  onImport: () => void
  onImportFiles: (files: FileList) => void
}

const KIND_ICON: Record<MediaSource['kind'], string> = { video: '🎬', audio: '🎵', csv: '📈' }

export default function MediaBin({ width, sources, onImport, onImportFiles }: Props) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <aside className="mediabin panel" style={{ width, flexShrink: 0 }}>
      <div className="panel__header">Media</div>
      <div
        className={'mediabin__drop' + (dragOver ? ' mediabin__drop--over' : '')}
        onClick={onImport}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length) onImportFiles(e.dataTransfer.files)
        }}
      >
        <p>Drag files here</p>
        <span className="mediabin__sub">video · audio · CSV — or click to browse</span>
      </div>

      <div className="panel__header panel__header--sub">Sources ({sources.length})</div>
      <ul className="mediabin__list">
        {sources.length === 0 && <li className="mediabin__placeholder">No media yet</li>}
        {sources.map((s) => (
          <li key={s.id} className="mediabin__item">
            <span className="mediabin__icon">{KIND_ICON[s.kind]}</span>
            <span className="mediabin__name" title={s.name}>
              {middleEllipsis(s.name, 22)}
            </span>
            <span className="mediabin__hint">{s.fullDuration ? `${s.fullDuration.toFixed(1)}s` : '—'}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
