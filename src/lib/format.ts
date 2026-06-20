/** Shorten a long string keeping both ends visible: "my_long_…_final.mp4". */
export function middleEllipsis(text: string, max = 28): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return text.slice(0, head) + '…' + text.slice(text.length - tail)
}

/** Seconds -> mm:ss or mm:ss.cs depending on zoom precision. */
export function fmtTime(s: number, withCenti = false): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  if (!withCenti) return base
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return `${base}.${String(cs).padStart(2, '0')}`
}
