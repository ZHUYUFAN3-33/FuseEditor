import { useState, type ReactNode } from 'react'
import { Activity, Check, Film, Lock, Music, Plus, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import type { MediaSource, RawItem } from '../types'
import { middleEllipsis } from '../lib/format'
import { PROCESS_PARAMS } from '../lib/process'

interface Props {
  width: number
  rawData: RawItem[]
  librarySources: MediaSource[]
  onTimelineSourceIds: Set<string>
  processingId: string | null
  onImport: () => void
  onImportFiles: (files: FileList) => void
  onNewCarrier: () => void
  onProcess: (rawId: string) => void
  onProcessAll: () => void
  onRemoveRaw: (rawId: string) => void
  onRemoveSource: (sourceId: string) => void
  onRelink: (sourceId: string) => void
  onRelinkAll: () => void
  onDragSourceStart: (kind: MediaSource['kind']) => void
  onDragSourceEnd: () => void
}

const KIND_ICON: Record<MediaSource['kind'], LucideIcon> = { video: Film, audio: Music, csv: Activity }

export default function LibraryPanel({
  width,
  rawData,
  librarySources,
  onTimelineSourceIds,
  processingId,
  onImport,
  onImportFiles,
  onNewCarrier,
  onProcess,
  onProcessAll,
  onRemoveRaw,
  onRemoveSource,
  onRelink,
  onRelinkAll,
  onDragSourceStart,
  onDragSourceEnd,
}: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | MediaSource['kind']>('all')
  // Hide the audio sources extracted from videos — they ride along with the video.
  const ready = librarySources.filter((s) => !s.name.endsWith(' · audio'))
  const visible = kindFilter === 'all' ? ready : ready.filter((s) => s.kind === kindFilter)
  const FILTERS: ['all' | MediaSource['kind'], ReactNode][] = [
    ['all', 'All'],
    ['video', <Film size={13} />],
    ['audio', <Music size={13} />],
    ['csv', <Activity size={13} />],
  ]
  const count = (k: 'all' | MediaSource['kind']) => (k === 'all' ? ready.length : ready.filter((s) => s.kind === k).length)
  const relinkCount = ready.filter((s) => s.needsRelink).length

  return (
    <aside className="library panel" style={{ width, flexShrink: 0 }}>
      {/* ① Import */}
      <div className="stage__header">
        <span className="stage__num">1</span> Import
      </div>
      <div
        className={'library__drop' + (dragOver ? ' library__drop--over' : '')}
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
        <p>Drop files</p>
        <span className="library__sub">raw CSV · video · audio</span>
      </div>
      <button
        className="library__carrier"
        title="Add a neutral all-ones data source (16ch) — draw an envelope over it to author the servo signal"
        onClick={(e) => {
          e.stopPropagation()
          onNewCarrier()
        }}
      >
        <Plus size={13} /> New carrier (all 1s)
      </button>

      {/* ② Process */}
      <div className="stage__header">
        <span className="stage__num">2</span> Process data
        {rawData.length > 1 && (
          <button className="stage__action" onClick={onProcessAll} disabled={!!processingId}>
            Process all
          </button>
        )}
      </div>
      <div className="stage__params" title="Fixed processing parameters (ported from your script)">
        60 Hz · SG win {PROCESS_PARAMS.SG_WINDOW}/poly {PROCESS_PARAMS.SG_POLY} · normalize · <Lock size={11} style={{ verticalAlign: '-2px' }} /> fixed
      </div>
      <ul className="library__list">
        {rawData.length === 0 && <li className="library__placeholder">No raw CSV waiting</li>}
        {rawData.map((r) => (
          <li key={r.id} className={'raw__item' + (r.error ? ' raw__item--err' : '')}>
            <div className="raw__row">
              <span className="mediabin__icon"><Activity size={15} /></span>
              <span className="library__name" title={r.name}>
                {middleEllipsis(r.name, 18)}
              </span>
              <button className="raw__btn" disabled={!!processingId} onClick={() => onProcess(r.id)}>
                {processingId === r.id ? '…' : 'Process'}
              </button>
              <button className="track__remove" title="Discard" onClick={() => onRemoveRaw(r.id)}>
                <X size={12} />
              </button>
            </div>
            {r.error && <div className="raw__err">{r.error}</div>}
          </li>
        ))}
      </ul>

      {/* ③ Ready → timeline */}
      <div className="stage__header">
        <span className="stage__num">3</span> Ready → timeline
        {relinkCount > 0 && (
          <button
            className="stage__action"
            onClick={onRelinkAll}
            title="Pick all the original media files at once — they auto-match by filename"
          >
            <TriangleAlert size={12} /> Re-link all ({relinkCount})
          </button>
        )}
      </div>
      <div className="library__filters">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={'library__filter' + (kindFilter === key ? ' library__filter--on' : '')}
            onClick={() => setKindFilter(key)}
            title={key === 'all' ? 'All' : key}
          >
            {label} <span className="library__filtercount">{count(key)}</span>
          </button>
        ))}
      </div>
      <ul className="library__list library__list--grow">
        {visible.length === 0 && (
          <li className="library__placeholder">
            {ready.length === 0 ? 'Process data / import media first' : `No ${kindFilter} sources`}
          </li>
        )}
        {visible.map((s) => {
          const onTl = onTimelineSourceIds.has(s.id)
          const KindIcon = KIND_ICON[s.kind]
          return (
            <li
              key={s.id}
              className={'library__item' + (s.needsRelink ? ' library__item--relink' : ' library__item--drag')}
              draggable={!s.needsRelink}
              title={s.needsRelink ? `Re-import "${s.name}" to restore` : 'Drag onto a track in the timeline'}
              onDragStart={(e) => {
                if (s.needsRelink) return
                e.dataTransfer.setData('text/experium-source', s.id)
                e.dataTransfer.effectAllowed = 'copy'
                onDragSourceStart(s.kind)
              }}
              onDragEnd={onDragSourceEnd}
            >
              <span className="mediabin__icon"><KindIcon size={15} /></span>
              <span className="library__name library__name--full" title={s.name}>
                {s.name}
              </span>
              {s.needsRelink ? (
                <button
                  className="library__relink"
                  title="Media missing — click to pick the original file and restore it"
                  onClick={() => onRelink(s.id)}
                >
                  <TriangleAlert size={11} /> re-link
                </button>
              ) : (
                <span className="library__hint">
                  {onTl && <Check size={11} />}
                  {s.fullDuration ? ` ${s.fullDuration.toFixed(1)}s` : ' —'}
                </span>
              )}
              <button
                className="track__remove"
                title="Delete from pool"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveSource(s.id)
                }}
              >
                <X size={12} />
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
