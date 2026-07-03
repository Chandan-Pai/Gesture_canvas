# GestureCanvas Dev Log

Running record of design decisions, changes, problems found, and fixes.

---

## [2026-06-19] - Initial baseline (initialization repo)

**Decision:** Ship Gesture Canvas as a vanilla JS baseline with no bundler — MediaPipe Hands, PDF.js, and Tesseract via CDN. Establish this repo as the shared **initialization** line before forking Jarvis and Phase 2.0 experiments.

**Changed:**
- `index.html` — app shell, CDN scripts, Creator Engine sidebar, PDF fullscreen UI, OCR overlay
- `src/main.js` — orchestrator (~2,500 lines): camera, gestures, drawing, PDF, pinch zoom/scroll, mirror mode
- `src/gestureClassifier.js` — draw / erase / pinch / fist / open-palm classification
- `src/shapeRecognizer.js` — circle, rectangle, line, triangle snap with confidence scoring
- `src/pdfImporter.js` — PDF.js load and page rasterization
- `src/style.css` — glass UI, fullscreen PDF layout, z-index layering
- `README.md` — project overview (initial version: open `index.html` directly)
- `.gitignore` — logs and env files

**Trade-offs:**
- CDN dependencies chosen over vendoring for zero build step; accepted offline/CDN-outage risk
- CSS transform for canvas zoom/rotate chosen over canvas-space transforms for faster implementation (known coord mismatch risk with hand landmarks — logged later)
- Two canvases (`#main-canvas` + `#hand-canvas`) to separate ink from hand skeleton overlay

**Next:** Split into three repos; add HTTPS dev server for reliable camera access.

---

## [2026-06-19] - Three-repo layout documented

**Decision:** Maintain three separate Git repos from the same baseline — `Gesture_canvas` (init), `jarvis-hand-controls`, `gesture-canvas-phase-2.0` — so each line evolves independently.

**Changed:**
- `REPOS.md` — local paths, GitHub remotes, publish steps, cherry-pick guidance
- `README.md` — related-repos table
- Commit: `67195f9` — Document three-repo layout and GitHub publish steps

**Trade-offs:** Manual sync between repos (cherry-pick/merge) instead of monorepo — simpler ownership, more overhead to port fixes.

**Next:** Publish all three repos to GitHub under `Chandan-Pai/*`.

---

## [2026-06-19] - HTTPS dev server added (local, uncommitted)

**Decision:** Add a Node HTTPS static server so camera and MediaPipe run in a secure context without manual cert setup every session. Prefer mkcert certs when available; fall back to OpenSSL self-signed.

**Changed:**
- `package.json` — `npm run dev` / `npm start` → `node server/dev-server.mjs`
- `server/dev-server.mjs` — HTTPS on port 3000 (IPv4 + IPv6), static file serving, auto cert generation
- `README.md` — HTTPS run instructions (`https://localhost:3000`), plain HTTP alternative on 8080
- `.gitignore` — `node_modules/`, `server/.cert/`

**Trade-offs:**
- HTTPS-only server (HTTP requests get empty response) — documented in server console output
- Self-signed/mkcert certs require one-time browser trust step
- Rejected: bundler/dev proxy (Vite etc.) — kept stack zero-build

**Next:** Commit dev server files; verify `npm run dev` on fresh clone.

---

## [2026-06-22] - Dev server run issues diagnosed (operational)

**Problem found:** `npm rundev` fails with `Unknown command: "rundev"` — missing space between `run` and `dev`.

**Fix:** Use `npm run dev` (with space). Documented in session; no code change required.

**Problem found:** Browser shows `ERR_EMPTY_RESPONSE` / "localhost didn't send any data" when opening `http://localhost:3000`.

**Root cause:** Dev server is HTTPS-only. Browser defaults to `http://` when typing `localhost:3000`.

**Fix:** Open **`https://localhost:3000`** explicitly. Certificate warning → Advanced → Proceed to localhost (or run `mkcert -install` once).

**Changed:** No repo files changed in this session for this issue — operational/documentation fix.

**Next:** Consider README callout box: "Must use https://"

---

## [2026-06-22] - Full application flow map completed

**Decision:** Document all user flows before prioritizing bug fixes — camera bootstrap, gesture loop, draw/erase, shape snap, PDF import/fullscreen/scroll, pinch move, two-hand zoom, mirror mode, sidebar, OCR, dev server, mouse/touch fallbacks.

**Changed:** Analysis only (no code). Flow map covers 19 flows across `main.js`, `gestureClassifier.js`, `shapeRecognizer.js`, `pdfImporter.js`, `dev-server.mjs`.

**Key flows identified:**
1. App init + `initHandTracking()` async camera startup
2. Per-frame `onHandResults()` → classify → draw/erase/pinch/zoom/pause
3. PDF as first-class stroke object with `pdfId`-linked annotations
4. Fullscreen PDF: single-hand pinch scroll + momentum
5. Two-hand pinch: canvas CSS zoom/rotate OR PDF document zoom
6. Mouse/touch fallback when camera unavailable

**Next:** Use flow map to prioritize fixes from issue audit.

---

## [2026-06-22] - Issue audit completed (35+ items, mostly open)

**Decision:** Catalog all known bugs and UX gaps before fixing — grouped by Critical / High / Medium / Low.

**Problems found (not yet fixed in code):**

### Critical (3)
| ID | Issue |
|----|-------|
| C1 | PDF annotations don't scroll with document in fullscreen — ink drifts from pages after `scrollY` changes |
| C2 | Hand landmark coords ignore CSS view transform — finger and ink misalign after two-hand zoom/rotate |
| C3 | Concurrent `hands.send()` in async `onFrame` — no frame-drop guard; overlapping inference possible |

### High (7)
| ID | Issue |
|----|-------|
| H1 | Dev server can serve TLS private keys from `server/.cert/` |
| H2 | Toolbar Draw/Erase/Select ignored by gesture path — `activeMode` only gates mouse |
| H3 | Embedded PDF always shows page 1 — `pageIndex` never updated |
| H4 | OCR "Replace on canvas" — JS references `#ocr-replace` but button missing from HTML |
| H5 | OCR fails silently when no drawable strokes |
| H6 | CDN deps (MediaPipe, PDF.js, Tesseract) — no SRI, no fallback, no load error UI |
| H7 | Camera failure UX incomplete — "Live" badge stays green; no retry; no in-app HTTPS guidance |

### Medium (13) — includes `holdSnapPoint` logic bug, dead `updatePdfScrollTwoHand`, resize doesn't scale strokes, export PNG ignores CSS transform, PDF toolbar width JS/CSS mismatch (216 vs 200px), clear canvas doesn't reset in-progress gesture strokes, etc.

### Low (12) — dead code, decorative nav links, performance (full redraw per point), touch single-touch only, etc.

**Problems fixed this session:** None in application code — audit and documentation only. Operational fixes: `npm run dev` spelling, HTTPS URL.

**Trade-offs:** Chose audit-first over immediate patches so fixes can be prioritized (C1 → C2 → C3 → H1).

**Next:** Fix Critical issues C1–C3; add missing `#ocr-replace` button or remove dead code.

---

## [2026-06-22] - Design decision logging process established

**Decision:** Use Option B — `DEVLOG.md` in repo + `.cursor/rules/devlog.mdc` for Cursor-guided logging. Manual Notion sync (copy/paste) for now; optional GitHub Action or Notion MCP later for automation.

**Changed:**
- `DEVLOG.md` — this file (created with full backfill)
- `.cursor/rules/devlog.mdc` — always-apply rule for session logging

**Trade-offs:**
- Rejected immediate Notion API automation — faster to ship; rules don't auto-log without a prompt
- Rejected native Notion integration — doesn't exist; MCP or API script required later
- Notion MCP + Cursor Automation = possible but likely needs paid Cursor plan for daily auto-run

**Next:** End each session with "log today's progress to DEVLOG.md"; commit `DEVLOG.md` with code changes.

---

## [2026-06-22] Daily Summary

**Worked on:**
- Diagnosed `npm run dev` and `ERR_EMPTY_RESPONSE` (HTTPS vs HTTP)
- Mapped all 19 application flows end-to-end
- Completed 35+ item issue audit (Critical → Low)
- Researched Notion + Cursor logging options (Option A API vs Option B DEVLOG.md)
- Created `DEVLOG.md` and `.cursor/rules/devlog.mdc` with historical backfill

**Status:**
- App runs via `npm run dev` → `https://localhost:3000`
- Baseline feature-complete; known critical bugs documented but not patched
- Dev server + README updates exist locally (uncommitted alongside this DEVLOG)
- Three-repo docs committed; initialization baseline committed Jun 19

**Blockers:**
- None for local dev once HTTPS URL is used
- Code fixes backlog: C1 (PDF annotation scroll), C2 (hand coord transform), C3 (MediaPipe frame guard) are top priority
- DEVLOG → Notion sync still manual until GitHub Action or MCP is set up

---

## [2026-06-22] - Nightly DEVLOG → Notion sync (Option B)

**Decision:** Automate end-of-day Notion sync with a local Node script + macOS LaunchAgent (11 PM daily). Full overwrite of a single Notion page from `DEVLOG.md` — no GitHub Action required.

**Changed:**
- `scripts/sync-devlog-to-notion.mjs` — reads `DEVLOG.md`, converts markdown → Notion blocks, replaces page content
- `scripts/install-launchagent.sh` — installs nightly schedule via `launchd`
- `scripts/uninstall-launchagent.sh` — removes schedule
- `.env.example` — `NOTION_TOKEN`, `NOTION_PAGE_ID`
- `package.json` — `npm run sync:devlog`, `@notionhq/client`, `@tryfabric/martian`

**Trade-offs:**
- Mac must be on at sync time (or job runs next time machine wakes — launchd behavior)
- Full page overwrite — edits made directly in Notion are replaced each sync
- Rejected GitHub Action path — wanted local push without daily commit requirement

**Next:** Create Notion integration + page, fill `.env`, run `npm run sync:devlog`, then `bash scripts/install-launchagent.sh`.

---

## [2026-06-22] - Notion integration connected and first sync succeeded

**Decision:** Use Notion internal integration **GestureCanvas Devlog** (single workspace, Chandan Pai's Space) with Read + Update + Insert content capabilities.

**Changed:**
- `.env` — `NOTION_TOKEN` + `NOTION_PAGE_ID` (local only, gitignored)
- `scripts/sync-devlog-to-notion.mjs` — accept full Notion Share links, not just 32-char IDs

**Problems found & fixed:**
| Problem | Fix |
|---------|-----|
| `cp .env.example .env` wiped filled-in credentials | Re-enter token + page link; don't re-copy template over `.env` |
| `NOTION_PAGE_ID must be 32 characters` | User pasted full Share URL — script now extracts ID from link |
| `object_not_found` on sync | Connected **GestureCanvas Devlog** on target page via **⋯ → Connections** |
| Dry-run showed empty env vars | Save `.env` after editing (Cmd+S) |

**Result:** `npm run sync:devlog` succeeded — 109 blocks uploaded to Notion.

**Next:** Run `bash scripts/install-launchagent.sh` for 11 PM nightly sync (optional).

---

## [2026-06-22] Daily Summary (end of day)

**Worked on:**
- Diagnosed local dev (`npm run dev`, HTTPS URL)
- Full app flow map + 35+ issue audit (C1–L12)
- Created `DEVLOG.md` + `.cursor/rules/devlog.mdc`
- Built Notion sync pipeline (`scripts/sync-devlog-to-notion.mjs`, launchagent installers)
- Set up Notion **GestureCanvas Devlog** integration
- First successful `DEVLOG.md` → Notion sync (109 blocks)

**Status:**
- App runs at `https://localhost:3000`
- Design decision log live in repo + mirrored to Notion
- Manual sync: `npm run sync:devlog` — **working**
- Nightly auto-sync: install with `bash scripts/install-launchagent.sh` if not done yet
- Large uncommitted set: dev server, DEVLOG tooling, scripts, `.cursor/rules/`
- Code bug backlog unchanged (C1 PDF annotations, C2 hand coords, C3 MediaPipe frame guard)

**Blockers:**
- None for Notion sync
- Critical app bugs still open — not addressed today

---

## [2026-06-22] - Chrome extension MVP (gesture overlay)

**Decision:** Ship minimal Chrome extension for video-call screen share — gesture-only input (index pointer/write), no mouse drawing. Phone companion via WebSocket relay on dev server.

**Changed:**
- `extension/` — Manifest V3: overlay, popup, background, gesture controller
- `extension/content/overlay.js` — laser layer, ink layer (pen/arrow/box), minimal status pill
- `extension/companion/` — MediaPipe gesture controller (extension page)
- `companion/index.html` — phone gesture controller
- `server/dev-server.mjs` — WebSocket relay at `/ws`, serves `/companion/`
- `extension/README.md` — load and usage instructions

**Trade-offs:**
- Requires `npm run dev` for phone relay (wss://localhost:3000/ws)
- Extension companion on laptop uses chrome.runtime (no relay needed)
- Mouse not used for ink — gestures + mode buttons only

**Next:** Load unpacked extension, test Meet tab share flow, tune mapping calibration.

---
