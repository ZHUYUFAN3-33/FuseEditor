import type { CsvData, MediaSource, Project, TrackKind, TrackMix } from '../types'

export interface SerializedSource {
  id: string
  kind: TrackKind
  name: string
  fullDuration: number
  linkedAudioId?: string
  csv?: CsvData // embedded for CSV sources; tiny and fully restorable
}

export interface ProjectView {
  pixelsPerSecond: number
  trackHeight: number
  ampScale: number
  masterVolume: number
}

export interface ProjectSnapshot {
  version: 1
  app: 'experium-editor'
  savedAt: string
  project: Project
  mixer: Record<string, TrackMix>
  view: ProjectView
  sources: SerializedSource[]
}

/**
 * Build a serializable snapshot. Media binaries (AudioBuffer / object URLs) are
 * dropped — they're restored from IndexedDB blobs (autosave) or re-linked (file).
 * CSV data is embedded so the servo data always travels with the project.
 */
export function serializeProject(args: {
  project: Project
  mixer: Record<string, TrackMix>
  sources: Record<string, MediaSource>
  view: ProjectView
  savedAt: string
}): ProjectSnapshot {
  const sources: SerializedSource[] = Object.values(args.sources).map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    fullDuration: s.fullDuration,
    linkedAudioId: s.linkedAudioId,
    csv: s.csv,
  }))
  return {
    version: 1,
    app: 'experium-editor',
    savedAt: args.savedAt,
    project: args.project,
    mixer: args.mixer,
    view: args.view,
    sources,
  }
}

export function parseProjectFile(text: string): ProjectSnapshot {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('檔案不是有效的 JSON')
  }
  const d = data as Partial<ProjectSnapshot>
  // 'experium-editor' is the original on-disk format tag; kept for backward-compat so existing
  // .experium files still load after the app was renamed to FuseEditor.
  if ((d?.app !== 'experium-editor' && d?.app !== 'fuse-editor') || !d.project || !Array.isArray(d.sources)) {
    throw new Error('不是有效的 FuseEditor 專案檔（.experium）')
  }
  return d as ProjectSnapshot
}
