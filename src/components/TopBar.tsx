import { AudioWaveform, Check, Download, Moon, Redo2, Sun, Undo2, Upload } from 'lucide-react'

interface Props {
  busy: boolean
  saveStatus: 'idle' | 'saving' | 'saved'
  theme: 'dark' | 'light'
  onImport: () => void
  onExport: () => void
  onSaveProject: () => void
  onOpenProject: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleTheme: () => void
  canUndo: boolean
  canRedo: boolean
}

export default function TopBar({
  busy,
  saveStatus,
  theme,
  onImport,
  onExport,
  onSaveProject,
  onOpenProject,
  onUndo,
  onRedo,
  onToggleTheme,
  canUndo,
  canRedo,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">
          <AudioWaveform size={20} strokeWidth={2.4} />
        </span>
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
          {saveStatus === 'saving' ? (
            'saving…'
          ) : saveStatus === 'saved' ? (
            <>
              <Check size={12} /> saved
            </>
          ) : (
            ''
          )}
        </span>
        {busy && <span className="topbar__busy">decoding…</span>}
        <button className="topbar__btn" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} />
        </button>
        <button className="topbar__btn" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} />
        </button>
        <button
          className="topbar__theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="topbar__btn topbar__btn--ghost" onClick={onImport}>
          <Upload size={15} /> Import
        </button>
        <button className="topbar__btn topbar__btn--primary" onClick={onExport}>
          <Download size={15} /> Export
        </button>
      </div>
    </header>
  )
}
