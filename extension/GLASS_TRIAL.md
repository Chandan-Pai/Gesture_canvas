# Liquid glass trial (extension UI)

Experimental visionOS-style glass on extension chrome. **Easy revert:**

```bash
git restore extension/lib/glass-theme.css \
  extension/sidepanel/sidepanel.css extension/sidepanel/index.html \
  extension/popup/popup.css extension/popup/popup.html \
  extension/camera-grant/grant.css extension/camera-grant/index.html \
  extension/content/overlay.css
rm extension/GLASS_TRIAL.md   # optional
```

## Try locally

1. `chrome://extensions` → **Reload** Gesture Canvas
2. Open extension **popup** (toolbar icon)
3. **Start on this tab** → check **side panel** + camera grant tab
4. Present a tab → bottom **overlay toolbar** (light glass)

## What changed

| Surface | Glass level |
|---------|-------------|
| Side panel | Full — blur, gold accents |
| Popup | Full |
| Camera grant | Full |
| Meet overlay toolbar | Light — blur + gold border (performance-safe) |

Pointer mode stays **red** (laser brand). Other active states use **gold**.
