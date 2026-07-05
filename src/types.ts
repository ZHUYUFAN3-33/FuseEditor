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
  linkedAudioId?: string // for video sources: the companion audio source extracted from it
  needsRelink?: boolean // loaded from a .experium file without its media — re-import to restore
}

/** A raw uploaded CSV awaiting processing (stage ② of the workflow). */
export interface RawItem {
  id: string
  name: string
  text: string
  error?: string
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
  fadeIn?: number // fade-in ramp (s) from the clip's start
  fadeOut?: number // fade-out ramp (s) to the clip's end
}

/** One point on a track's intensity (0..1) automation curve, in timeline seconds. */
export interface Keyframe {
  t: number
  v: number
}

export interface Track {
  id: string
  kind: TrackKind
  name: string
  color: string
  intensity?: Keyframe[] // 0..1 gain applied along the timeline; empty/undefined = full (1)
}

/** The part of project state that is undoable. */
export interface Project {
  tracks: Track[]
  clips: Clip[]
}
