# FuseEditor

A pure front-end, browser-based non-linear editor for **video**, **multi-track audio**, and **16-channel time-series CSV** on one shared timeline.

FuseEditor exists to author **servo-drive signals for haptic robotic hands**: import recorded FMG (muscle-activity) data next to the reference video, normalize it, shape it by drawing intensity envelopes over the data, then **export a gap-free CSV** or **stream live to TouchDesigner** to drive the servo motors — all aligned frame-accurately to the video.

## Status
🟢 **Working.** Video/audio/CSV editing, the FMG processing pipeline, envelope authoring, CSV/WAV export, and live TouchDesigner streaming are all functional. Everything runs in the browser — no backend.

## Stack
- **Vite + React + TypeScript** — pure front-end; all decoding, processing, and export happen client-side.
- Electron packaging planned later for ffmpeg-based mp4 export.

## Run
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

## What it does

### Timeline editing (DaVinci-style)
- Importing a video auto-creates a video track **plus a separate track for its audio**.
- Multi-track audio and CSV/data lanes; drag clips from the media bin onto tracks.
- Blade/split, merge, drag-move (cross-track), edge-trim, snapping, ripple delete, duplicate, arrow-key nudge — clips never overlap (resolved on drop/release).
- **Multi-select + rigid group move** — ⌘/⇧-click several clips (across tracks) and drag them as one unit; the whole group stops the moment any clip would overlap, so relative timing is preserved when time-aligning video + data together.
- Full snapshot **undo/redo**; playhead scrub, loop, per-frame stepping.
- Zoom timeline (px/s), track height, and visualization amplitude — zoom anchors on the playhead.

### Preview
- **Multi-video grid** — when the playhead sits over more than one video, they render side-by-side (for time-aligning multiple takes).
- Responsive scrubbing via coalesced seeks.

### Audio
- Multi-track Web Audio mixdown with per-track **mute / solo / volume / lock**, plus master volume.
- Waveform visualization; per-clip fade in/out.

### FMG / time-series pipeline (the core)
- Three-stage media bin: **① Import → ② Process → ③ Ready → timeline.**
- Raw FMG CSVs run through a **faithful JS port of the reference Python**: align timestamps → resample to **60 Hz** → min-max normalize → **Savitzky–Golay** smoothing (window 9, poly 3). **These parameters are fixed** and verified against SciPy to < 1e-6. Malformed input is rejected with a clear error instead of being guessed.
- Bottom-anchored curve visualization (rest near 0, activity toward 1).
- Generate a neutral all-ones **carrier** to author a servo signal from scratch.

### Envelope authoring
- Every CSV/audio track carries an **intensity envelope** (0..1 keyframes; linear / smooth / hold) multiplied onto the data — this is how the servo signal is shaped.
- Draw it inline on the track, or in a dedicated **full-screen envelope editor** with the raw data faint behind it.
- The envelope **follows its clip** when moved, so drawn shapes stay aligned to the data.

### Export & live output
- **Timeline-aligned CSV** — the servo-drive signal: continuous time axis at an adjustable rate (default 60 Hz), value = `data × envelope × fade`, gaps (no clip) filled with `0` (servo neutral). Length matches the video; one file per data track.
- **WAV** audio mixdown — offline, exact, honors the mixer.
- **WebM** video — experimental (mp4 needs Electron/ffmpeg).
- **Live → TouchDesigner** over WebSocket (auto-reconnecting) — streams every frame's `data × envelope` to drive servos or preview in TD in real time.

## Project files
- **Autosave** to IndexedDB — survives reloads.
- Portable **`.experium`** project files (Open / Save): JSON with tracks / clips / mixer / envelopes and CSV embedded; heavy media is stripped and re-linked by re-importing the source files.

## Architecture
`MediaSource` (immutable decoded media) → `Clip` (a window into a source, placed on the timeline) → `Track` (a lane). The editable state is `{ tracks, clips }`, driven through a snapshot history for undo/redo. Mixer state (mute/solo/volume/lock) lives outside history.

## Roadmap
- [ ] Audio crossfade / intensity / fade baked into the WAV export
- [ ] Markers, frame-accurate timecode, J/K/L shuttle
- [ ] mp4 export via Electron + ffmpeg packaging
