# Gesture Canvas — Initialization

Baseline hand-tracking canvas: MediaPipe gestures, PDF import/fullscreen, pinch scroll, Creator Engine sidebar, and shape recognition.

This repo is the **initialization** line. Related repos (same baseline, separate development):

| Repo | Purpose |
|------|---------|
| **Gesture_canvas** (this repo) | Initialization baseline |
| **jarvis-hand-controls** | Jarvis-style hand control experiments |
| **gesture-canvas-phase-2.0** | Phase 2.0 features |

## Run locally (HTTPS — recommended)

Camera and MediaPipe work best over a secure context. Use the built-in dev server:

```bash
cd Gesture_canvas
npm run dev
```

Open **https://localhost:3000**

On first visit, the browser warns about the self-signed certificate → **Advanced → Proceed to localhost** (normal for local dev).

### Chrome extension (video calls)

See [extension/README.md](extension/README.md) — gesture overlay for shared tabs in Meet/Zoom.

```bash
npm run dev   # HTTPS + WebSocket relay for phone gestures
```

Load `extension/` unpacked in `chrome://extensions`.

### Alternative (plain HTTP)

```bash
python3 -m http.server 8080
```

Open **http://127.0.0.1:8080** (use `http://`, not `https://`).

## Stack

Vanilla JS — no bundler. MediaPipe Hands, PDF.js via CDN.
