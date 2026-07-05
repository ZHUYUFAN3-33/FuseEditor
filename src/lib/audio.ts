import type { Waveform } from '../types'

let sharedCtx: AudioContext | null = null

/** One AudioContext shared by decoding and the playback engine. */
export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedCtx = new AC()
  }
  return sharedCtx
}

function computePeaks(audioBuffer: AudioBuffer, bucketsPerSecond: number): number[] {
  const duration = audioBuffer.duration
  const totalBuckets = Math.max(1, Math.floor(duration * bucketsPerSecond))
  const channels: Float32Array[] = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c))
  const length = channels[0].length
  const samplesPerBucket = Math.max(1, Math.floor(length / totalBuckets))

  const peaks: number[] = []
  for (let b = 0; b < totalBuckets; b++) {
    const startSample = b * samplesPerBucket
    let max = 0
    for (let j = 0; j < samplesPerBucket; j++) {
      const i = startSample + j
      if (i >= length) break
      let sum = 0
      for (let c = 0; c < channels.length; c++) sum += channels[c][i]
      const v = Math.abs(sum / channels.length)
      if (v > max) max = v
    }
    peaks.push(max)
  }
  const globalMax = peaks.reduce((m, p) => (p > m ? p : m), 0) || 1
  for (let i = 0; i < peaks.length; i++) peaks[i] /= globalMax
  return peaks
}

/**
 * Decode an audio OR video file into a playable AudioBuffer + a downsampled waveform.
 * Throws if the file has no decodable audio.
 */
export async function decodeAudio(
  file: File,
  bucketsPerSecond = 120,
): Promise<{ audioBuffer: AudioBuffer; waveform: Waveform }> {
  const arrayBuffer = await file.arrayBuffer()
  const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer)
  return {
    audioBuffer,
    waveform: { peaks: computePeaks(audioBuffer, bucketsPerSecond), duration: audioBuffer.duration },
  }
}

/**
 * Read a media file's duration via a throwaway media element.
 * Blob/streamed mp4 & webm often report `Infinity` until forced to seek to the
 * end, so we nudge currentTime past the end and wait for the real duration.
 * Always resolves a finite, non-negative number (0 if truly unknown).
 */
export function getMediaDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind)
    el.preload = 'metadata'
    let settled = false
    let timer = 0
    const check = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) finish(el.duration)
    }
    const finish = (d: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      el.removeEventListener('durationchange', check)
      el.removeEventListener('seeked', check)
      try {
        el.removeAttribute('src')
        el.load()
      } catch {
        /* noop */
      }
      resolve(Number.isFinite(d) && d > 0 ? d : 0)
    }
    el.onloadedmetadata = () => {
      if (el.duration === Infinity || Number.isNaN(el.duration) || el.duration === 0) {
        el.addEventListener('durationchange', check)
        el.addEventListener('seeked', check)
        try {
          el.currentTime = 1e7 // force the browser to resolve the true duration
        } catch {
          /* noop */
        }
      } else finish(el.duration)
    }
    el.onerror = () => finish(0)
    timer = window.setTimeout(() => finish(el.duration), 5000) // never hang the import
    el.src = url
  })
}
