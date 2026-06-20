import { getAudioContext } from './audio'
import type { GainState, MediaSource, Project } from '../types'

/**
 * Sample-accurate multi-track mixer. Schedules every audio clip's buffer slice
 * through a per-track GainNode -> master -> destination, anchored to the
 * AudioContext clock so the timeline playhead stays in sync.
 */
export class AudioEngine {
  private ctx: AudioContext
  private master: GainNode
  private trackGains = new Map<string, GainNode>()
  private active: AudioBufferSourceNode[] = []
  private anchorCtxTime = 0
  private anchorPlayhead = 0
  playing = false

  private captureDest: MediaStreamAudioDestinationNode | null = null

  constructor() {
    this.ctx = getAudioContext()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
  }

  setMasterVolume(v: number) {
    this.master.gain.value = v
  }

  /** A live MediaStream of the master mix, for MediaRecorder-based video export. */
  createCaptureStream(): MediaStream {
    if (!this.captureDest) {
      this.captureDest = this.ctx.createMediaStreamDestination()
      this.master.connect(this.captureDest)
    }
    return this.captureDest.stream
  }
  disposeCapture() {
    if (this.captureDest) {
      try {
        this.master.disconnect(this.captureDest)
      } catch {
        /* noop */
      }
      this.captureDest = null
    }
  }

  private trackGain(trackId: string): GainNode {
    let g = this.trackGains.get(trackId)
    if (!g) {
      g = this.ctx.createGain()
      g.connect(this.master)
      this.trackGains.set(trackId, g)
    }
    return g
  }

  applyTrackGains(gains: Record<string, GainState>) {
    const anySolo = Object.values(gains).some((s) => s.solo)
    for (const [tid, s] of Object.entries(gains)) {
      const on = !s.muted && (!anySolo || s.solo)
      this.trackGain(tid).gain.value = on ? s.volume : 0
    }
  }

  private stopSources() {
    for (const n of this.active) {
      try {
        n.stop()
      } catch {
        /* already stopped */
      }
      try {
        n.disconnect()
      } catch {
        /* noop */
      }
    }
    this.active = []
  }

  async play(
    fromSec: number,
    project: Project,
    sources: Record<string, MediaSource>,
    gains: Record<string, GainState>,
    masterVolume: number,
  ) {
    await this.ctx.resume()
    this.stopSources()
    this.setMasterVolume(masterVolume)
    this.applyTrackGains(gains)

    const now = this.ctx.currentTime
    this.anchorCtxTime = now
    this.anchorPlayhead = fromSec
    this.playing = true

    for (const clip of project.clips) {
      const buf = sources[clip.sourceId]?.audioBuffer
      if (!buf) continue
      const clipEnd = clip.start + clip.duration
      if (clipEnd <= fromSec) continue
      const effStart = Math.max(clip.start, fromSec)
      const delay = effStart - fromSec
      const offset = clip.inPoint + (effStart - clip.start)
      const dur = clipEnd - effStart
      if (dur <= 0 || offset >= buf.duration) continue

      const node = this.ctx.createBufferSource()
      node.buffer = buf
      node.connect(this.trackGain(clip.trackId))
      node.start(now + delay, offset, Math.min(dur, buf.duration - offset))
      this.active.push(node)
    }
  }

  pause() {
    this.anchorPlayhead = this.getTime()
    this.playing = false
    this.stopSources()
  }

  getTime(): number {
    if (!this.playing) return this.anchorPlayhead
    return this.anchorPlayhead + (this.ctx.currentTime - this.anchorCtxTime)
  }
}
