# Experium Editor

A browser-based editor for **video**, **audio**, and **time-series CSV** on a shared timeline.

## Status
🟡 UI skeleton — layout and panels are in place; functionality comes next.

## Stack
- Vite + React + TypeScript (pure front-end, runs locally in the browser)

## Run
```bash
npm install
npm run dev      # opens http://localhost:5173
```

## Layout
- **Top bar** — File / Edit / View menus, Import / Export
- **Media bin** (left) — drop zone for video / audio / CSV files
- **Preview** (center) — video stage + transport controls
- **Inspector** (right) — properties of the selected track
- **Timeline** (bottom) — three synced tracks: Video · Audio · CSV/time-series

## Roadmap (next steps)
- [ ] Load real files (File API) and show them in the media bin
- [ ] Render video into the preview (`<video>`) with a working playhead
- [ ] Parse CSV and draw the time-series curve aligned to the timeline
- [ ] Draw audio waveform (Web Audio API)
- [ ] Drag / trim / split clips on the timeline
- [ ] Export (later: package as an Electron desktop app for ffmpeg processing)
