interface Props {
  axis: 'x' | 'y' // 'x' = vertical bar that resizes width; 'y' = horizontal bar that resizes height
  onDelta: (deltaPx: number) => void
}

/** A thin draggable divider. Emits incremental pixel deltas while dragging. */
export default function ResizeHandle({ axis, onDelta }: Props) {
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    let last = axis === 'x' ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => {
      const cur = axis === 'x' ? ev.clientX : ev.clientY
      onDelta(cur - last)
      last = cur
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return <div className={`reszh reszh--${axis}`} onPointerDown={onPointerDown} />
}
