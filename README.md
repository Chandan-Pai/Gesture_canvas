# Gesture Canvas

Hand-gesture control for drawing, presenting, and collaborating — powered by MediaPipe Hands.

This repo includes:

- **Web app** — fullscreen canvas with PDF import, shape recognition, pinch scroll, and Creator Engine
- **Chrome extension** — laser pointer and ink overlay on shared tabs (Google Slides, Meet, Zoom)
- **Companion / relay** — phone or second device sends gestures over WebSocket

Related repos (same baseline, separate development):

| Repo | Purpose |
|------|---------|
| **Gesture_canvas** (this repo) | Web app + Chrome extension |
| **jarvis-hand-controls** | Jarvis-style hand control experiments |
| **gesture-canvas-phase-2.0** | Phase 2.0 features |

## Quick start — web app

Camera and MediaPipe need a secure context. Use the built-in dev server:

```bash
npm install
npm run dev
```

Open **https://localhost:3000** and accept the self-signed certificate (Advanced → Proceed to localhost).

### Plain HTTP (optional)

```bash
python3 -m http.server 8080
```

Open **http://127.0.0.1:8080**

## Quick start — Chrome extension (Slides / Meet)

Present with hand gestures on a shared browser tab.

1. `npm run dev` (HTTPS + WebSocket relay)
2. Chrome → `chrome://extensions` → **Load unpacked** → select `extension/`
3. Open Google Slides → extension popup → **Start on this tab**
4. Allow camera in the grant tab; keep the **presenter side panel** open
5. In Meet → **Present this tab**

Full setup, troubleshooting, and webinar (entire-screen) mode: **[extension/README.md](extension/README.md)**

### Gestures (extension v0.6)

| Gesture | Action |
|---------|--------|
| ☝ Index finger | Red laser (Pointer) / draw (Write) |
| ✌ Peace sign | Erase ink at finger (**Write mode only**) |
| 🤟 Three fingers (index + middle + ring) | Toggle Pointer ↔ Write |
| 🤏 Pinch | Laser / pan ink layer |
| ⊕ Two-hand pinch | Zoom ink |
| ✊ Fist | Finish stroke |
| 🖐 Open palm (hold 1s) | Reset ink zoom/pan |
| 👍 Thumbs up (hold, release) | Next slide |
| 👎 Thumbs down (hold, release) | Previous slide |

## Hosted companion (GitHub Pages)

Companion site for remote gesture controllers:

**https://chandanpai.github.io/Gesture_canvas/companion/?session=YOUR_ID**

Enable **Pages → Source: GitHub Actions** in repo settings (workflow in `.github/workflows/pages.yml`).

## Project layout

```
index.html          Web app entry
src/                Canvas app (gestures, PDF, shapes)
extension/          Chrome extension (load unpacked)
companion/          Local dev gesture controller
docs/               GitHub Pages site
server/             HTTPS dev server + relay
relay/              Standalone WebSocket relay
scripts/            Dev utilities
```

## Stack

Vanilla JS — no bundler. MediaPipe Hands, PDF.js via CDN.
