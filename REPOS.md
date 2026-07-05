# Three-repo setup

This project is split into **three separate Git repos**, all starting from the same baseline commit.

| Local folder | GitHub remote (create if missing) | Role |
|--------------|-----------------------------------|------|
| `Gesture_canvas` | `Chandan-Pai/Gesture_canvas` | **Initialization** baseline |
| `jarvis-hand-controls` | `Chandan-Pai/jarvis-hand-controls` | Jarvis hand controls line |
| `gesture-canvas-phase-2.0` | `Chandan-Pai/gesture-canvas-phase-2.0` | Phase 2.0 line |
| `gesture-canvas-visionos` | *(create on GitHub)* | visionOS / Vision Pro presenter |

Local paths (siblings under `Documents/GitHub/`):

```
Documents/GitHub/
├── Gesture_canvas/              ← initialization (this repo)
├── jarvis-hand-controls/
├── gesture-canvas-phase-2.0/
└── gesture-canvas-visionos/     ← SwiftUI visionOS app (Gesture Canvas baseline)
```

Each repo has its own `main` branch and history. Change one repo without affecting the others. To sync a fix from initialization into another line, cherry-pick or merge manually.

## Publish to GitHub

1. On GitHub (logged in as **Chandan-Pai**), create two **empty** repos (no README):
   - `jarvis-hand-controls`
   - `gesture-canvas-phase-2.0`
   - `Gesture_canvas` may already exist.

2. Push each local repo (use the account that owns `Chandan-Pai/*`):

```bash
cd ~/Documents/GitHub/Gesture_canvas
git push -u origin main

cd ~/Documents/GitHub/jarvis-hand-controls
git push -u origin main

cd ~/Documents/GitHub/gesture-canvas-phase-2.0
git push -u origin main
```

If you see `Permission denied to Chandanpai13`, sign in with the **Chandan-Pai** GitHub account (SSH key or HTTPS credential for that org/user).

## Optional: private repos

On GitHub → repo **Settings → General → Danger zone → Change visibility** → Private. Git has no per-branch passwords; privacy is at the **repo** level.
