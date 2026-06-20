import type { CsvData, Series } from '../types'

/**
 * Parse a time-series CSV. Assumes the first column is the time axis (seconds)
 * and every remaining numeric column is a series to plot.
 */
export function parseCsv(text: string): CsvData {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  if (lines.length < 2) return { duration: 0, series: [], timeColumn: 't' }

  const header = splitRow(lines[0])
  const timeColumn = header[0] ?? 't'
  const valueCols = header.slice(1)

  const series: Series[] = valueCols.map((name) => ({
    name: name || `col${header.indexOf(name)}`,
    points: [],
    min: Infinity,
    max: -Infinity,
  }))

  let duration = 0
  for (let r = 1; r < lines.length; r++) {
    const cells = splitRow(lines[r])
    const t = parseFloat(cells[0])
    if (!isFinite(t)) continue
    if (t > duration) duration = t
    for (let c = 0; c < valueCols.length; c++) {
      const v = parseFloat(cells[c + 1])
      if (!isFinite(v)) continue
      const s = series[c]
      s.points.push({ t, v })
      if (v < s.min) s.min = v
      if (v > s.max) s.max = v
    }
  }

  // Drop empty / constant-less series; guard ranges.
  for (const s of series) {
    if (!isFinite(s.min)) s.min = 0
    if (!isFinite(s.max)) s.max = 1
    if (s.min === s.max) s.max = s.min + 1
  }

  return { duration, series: series.filter((s) => s.points.length > 0), timeColumn }
}

function splitRow(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}
