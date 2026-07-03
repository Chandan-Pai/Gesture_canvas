# Gesture Canvas — Chrome Extension

Minimal gesture overlay for shared screens (Google Meet, Zoom, Teams).

## Features (v0.2)

- **Screen pointer (webinar)** — fullscreen overlay over your display; share **Entire screen** in Meet
- **Tab mode** — overlay on a specific browser tab; share that tab
- **Pointer / Write / Off** — index finger laser; pen, arrow, box
- **Collaboration** — multiple companions per session (unique laser colors); hosted companion on GitHub Pages
- **Session export** — composite PNG + `meta.json` + `strokes.json` (tab mode)

## Setup

### 1. Run dev server (HTTPS + WebSocket relay)

```bash
npm install
npm run dev
```

**Once per machine:** open https://localhost:3000 and accept the certificate (Advanced → Proceed).  
Optional: `mkcert -install` to remove warnings.

### 2. Load extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. After updates, click **Reload** on the extension card

### 3a. Webinar mode (Mac — entire screen in Meet)

1. Join Meet first (optional), then click **Start screen pointer**
2. A borderless overlay covers your **primary monitor** — you should see your desktop through it (toolbar at bottom)
3. Extension popup → **Gesture controller** → enter session ID → allow camera
4. In Meet: **Present now → Entire screen** → pick **this monitor**
5. Point with index finger — laser appears over anything on screen

**Mac note:** If the overlay looks white, click **Off** on the toolbar, use apps underneath, then **Pointer** again. Share **Entire screen**, not a single window.

**Order matters:** Start screen pointer → open companion → share entire screen in Meet.

### 3b. Tab mode (browser content only)

1. Open the page you will share
2. Extension → **Start on this tab**
3. In Meet: **Present this tab**
4. Open gesture controller with the session ID

A pinned **relay** tab opens automatically — leave it open.

### Gesture controller URLs

| Environment | URL |
|-------------|-----|
| Local dev | `https://localhost:3000/companion/?session=YOUR_ID` |
| GitHub Pages | `https://chandanpai.github.io/Gesture_canvas/companion/?session=YOUR_ID` |

Guests can join the same session ID for collaboration (each gets a unique laser color).

### Hosted relay (optional)

For remote guests without `npm run dev` on the host machine:

```bash
npm run relay   # or deploy relay/standalone-relay.mjs
```

Set `GC_PUBLIC_WS` in `extension/lib/gc-config.js` and `docs/lib/gc-config.js`.

### Troubleshooting

| Error | Fix |
|-------|-----|
| Pointer not visible in Meet | Webinar: share **Entire screen**, not Word window only |
| WebSocket / relay failed | Run `npm run dev`, visit https://localhost:3000 once (accept cert). Relay runs in a pinned tab, not the service worker. |
| `ERR_CERT_AUTHORITY_INVALID` in service worker | Fixed in v0.2.4 — reload extension. Trust cert by visiting https://localhost:3000 in a normal tab. Optional: `mkcert -install` |
| Gestures not on overlay | Session IDs must match; relay tab must stay open |
| Screen overlay missing | Reload extension; check `windows` permission |

### Gestures (v0.5 — matches localhost Gesture Canvas + presentation extras)

| Gesture | Action |
|---------|--------|
| ☝ Index (DRAW) | Laser / draw |
| ✌ Peace (ERASE) | Erase ink at finger |
| 🤟 Three fingers (index+middle+ring) | Toggle Pointer ↔ Write |
| 🤏 Pinch | Laser / pan ink |
| ⊕ Two-hand pinch | Zoom ink |
| ✊ Fist | Finish stroke |
| 🖐 Open palm hold 1s | Reset ink zoom/pan |
| 👍 Thumbs up | Next slide |
| 👎 Thumbs down | Previous slide |

Use **Off / Pointer / Write** on the overlay toolbar or presenter side panel. Screen overlay shortcuts: `P` pointer, `W` write, `Esc` off.

## GitHub Pages

Enable **Pages → Source: GitHub Actions** in repo settings. The `docs/` folder deploys the public companion site on push to `main`.

## Project layout

```
extension/          Chrome extension (load unpacked)
companion/          Local dev gesture controller page
docs/               GitHub Pages site (companion + landing)
relay/              Standalone WebSocket relay for deploy
server/             HTTPS dev server + relay
```
