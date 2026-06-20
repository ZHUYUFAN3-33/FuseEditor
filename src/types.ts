export type TrackKind = 'video' | 'audio' | 'csv'

export interface Waveform {
  peaks: number[] // normalized 0..1 amplitude over the WHOLE source
  duration: number // seconds
}

export interface Series {
  name: string
  points: { t: number; v: number }[]
  min: number
  max: number
}

export interface CsvData {
  duration: number // max time value (seconds)
  series: Series[]
  timeColumn: string
}

/** Immutable decoded media. Clips reference these by id. */
export interface MediaSource {
  id: string
  kind: TrackKind
  name: string
  fullDuration: number
  waveform?: Waveform
  csv?: CsvData
  mediaUrl?: string
  audioBuffer?: AudioBuffer // decoded PCM for mixing playback (audio + video-audio)
}

/** Per-track mixer state (kept outside undo history). */
export interface TrackMix {
  muted: boolean
  solo: boolean
  volume: number // 0..1
  locked: boolean
}

/** The slice of mixer state the audio engine needs per track. */
export interface GainState {
  muted: boolean
  solo: boolean
  volume: number
}
export type GainMap = Record<string, GainState>

/** A window into a MediaSource, placed on the timeline. */
export interface Clip {
  id: string
  sourceId: string
  trackId: string
  name: string
  start: number // position on the timeline (seconds)
  inPoint: number // offset into the source (seconds)
  duration: number // length on the timeline (seconds)
}

export interface Track {
  id: string
  kind: TrackKind
  name: string
  color: string
}

/** The part of project state that is undoable. */
export interface Project {
  tracks: Track[]
  clips: Clip[]
}
