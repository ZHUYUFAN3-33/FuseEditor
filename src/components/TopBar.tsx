interface Props {
  busy: boolean
  onImport: () => void
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

export default function TopBar({ busy, onImport, onExport, onUndo, onRedo, canUndo, canRedo }: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">◐</span>
        <span className="topbar__title">Experium Editor</span>
      </div>
      <nav className="topbar__menu">
        <button className="topbar__btn">File</button>
        <button className="topbar__btn">Edit</button>
        <button className="topbar__btn">View</button>
        <button className="topbar__btn">Help</button>
      </nav>
      <div className="topbar__actions">
        {busy && <span className="topbar__busy">decoding…</span>}
        <button className="topbar__btn" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
          ↶
        </button>
        <button className="topbar__btn" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
          ↷
        </button>
        <button className="topbar__btn topbar__btn--ghost" onClick={onImport}>
          Import
        </button>
        <button className="topbar__btn topbar__btn--primary" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  )
}
