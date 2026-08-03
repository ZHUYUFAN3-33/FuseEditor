interface Props {
  busy: boolean
  saveStatus: 'idle' | 'saving' | 'saved'
  onImport: () => void
  onExport: () => void
  onSaveProject: () => void
  onOpenProject: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

export default function TopBar({
  busy,
  saveStatus,
  onImport,
  onExport,
  onSaveProject,
  onOpenProject,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">◐</span>
        <span className="topbar__title">FuseEditor</span>
      </div>
      <nav className="topbar__menu">
        <button className="topbar__btn" onClick={onOpenProject}>
          Open
        </button>
        <button className="topbar__btn" onClick={onSaveProject}>
          Save
        </button>
        <button className="topbar__btn">View</button>
        <button className="topbar__btn">Help</button>
      </nav>
      <div className="topbar__actions">
        <span className="topbar__save" title="Auto-saved to this browser">
          {saveStatus === 'saving' ? 'saving…' : saveStatus === 'saved' ? '✓ saved' : ''}
        </span>
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
