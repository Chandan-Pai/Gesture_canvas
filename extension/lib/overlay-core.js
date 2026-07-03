/**
 * Shared laser + ink overlay logic (tab content script + screen overlay page).
 */
import { PARTICIPANT_COLORS } from './gc-config.js';
import { dispatchSlideNavigation } from './slide-nav.js';

const DEFAULT_COLOR = '#ff1a1a';
const LASER_FADE_MS = 400;
const CURSOR_FADE_MS = 350;
const OPEN_PALM_RESET_MS = 1000;
const ERASE_RADIUS = 28;
const VIEW_SCALE_MIN = 0.5;
const VIEW_SCALE_MAX = 3;

function colorForParticipant(participantId) {
  if (!participantId) return DEFAULT_COLOR;
  let hash = 0;
  for (let i = 0; i < participantId.length; i++) {
    hash = (hash * 31 + participantId.charCodeAt(i)) | 0;
  }
  return PARTICIPANT_COLORS[Math.abs(hash) % PARTICIPANT_COLORS.length];
}

/** @param {Document} [doc] */
export function buildToolbar(doc = document) {
  const toolbar = doc.createElement('div');
  toolbar.id = 'gc-toolbar';

  const modes = doc.createElement('div');
  modes.id = 'gc-modes';
  modes.innerHTML = `
    <button type="button" data-mode="off">Off</button>
    <button type="button" data-mode="pointer" class="active">Pointer</button>
    <button type="button" data-mode="write">Write</button>
  `;

  const tools = doc.createElement('div');
  tools.id = 'gc-tools';
  tools.className = 'hidden';
  tools.innerHTML = `
    <button type="button" data-tool="pen" class="active">Pen</button>
    <button type="button" data-tool="arrow">Arrow</button>
    <button type="button" data-tool="box">Box</button>
  `;

  toolbar.append(modes, tools);
  toolbar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:6px;';
  return toolbar;
}

export function createOverlayController({
  root,
  laserCanvas,
  inkCanvas,
  toolbar,
  banner,
  defaultColor = DEFAULT_COLOR,
  bannerText = 'Gesture Canvas — share this tab',
  defaultMode = 'pointer',
  onSlideNavigate = null,
}) {
  const laserCtx = laserCanvas.getContext('2d');
  const inkCtx = inkCanvas.getContext('2d');

  let mode = defaultMode;
  let tool = 'pen';
  let strokes = [];
  let currentStroke = null;
  let arrowStart = null;
  let boxStart = null;
  /** @type {Map<string, { x: number, y: number, t: number }[]>} */
  const laserTrails = new Map();
  let openPalmSince = null;
  let lastPoint = null;
  let lastInkPoint = null;
  let animId = null;
  let activeColor = defaultColor;
  let viewScale = 1;
  let viewOffsetX = 0;
  let viewOffsetY = 0;
  let lastTwoHandSep = null;
  let pinchPanAnchor = null;
  let prevGesture = null;
  /** @type {{ x: number, y: number, kind: 'pen'|'erase', t: number } | null} */
  let cursorHint = null;

  function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function resetView() {
    viewScale = 1;
    viewOffsetX = 0;
    viewOffsetY = 0;
    redrawInk();
  }

  function screenToInk(x, y) {
    return {
      x: (x - viewOffsetX) / viewScale,
      y: (y - viewOffsetY) / viewScale,
    };
  }

  function dispatchSlideKey(direction) {
    if (onSlideNavigate) {
      onSlideNavigate(direction);
      return;
    }
    dispatchSlideNavigation(direction);
  }

  function setCursorHint(x, y, kind) {
    cursorHint = { x, y, kind, t: performance.now() };
  }

  function clearCursorHint() {
    cursorHint = null;
  }

  function drawPenCursor(ctx, x, y, alpha) {
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
    ctx.fillStyle = `rgba(56, 189, 248, ${alpha * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const arm = 16;
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill();
    ctx.restore();
  }

  function drawEraseCursor(ctx, x, y, alpha) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = `rgba(244, 114, 182, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, ERASE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    ctx.restore();
  }

  function eraseStrokesAt(x, y, radius = ERASE_RADIUS) {
    const before = strokes.length;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      let hit = false;
      if (s.type === 'pen' && s.points?.length) {
        hit = s.points.some(([px, py]) => dist(px, py, x, y) < radius);
      } else if (s.from && s.to) {
        hit =
          dist(s.from[0], s.from[1], x, y) < radius ||
          dist(s.to[0], s.to[1], x, y) < radius;
      }
      if (hit) strokes.splice(i, 1);
    }
    if (strokes.length !== before) redrawInk();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of [laserCanvas, inkCanvas]) {
      c.width = w;
      c.height = h;
    }
    redrawInk();
  }

  function normToScreen(nx, ny) {
    return {
      x: (1 - nx) * laserCanvas.width,
      y: ny * laserCanvas.height,
    };
  }

  function syncToolbar() {
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    toolbar.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    const toolsEl = toolbar.querySelector('#gc-tools');
    toolsEl?.classList.toggle('hidden', mode !== 'write');
  }

  function setMode(next) {
    mode = next;
    root?.classList.toggle('interactive', mode === 'write');
    syncToolbar();
    if (mode !== 'write') {
      finishStroke();
      arrowStart = null;
      boxStart = null;
    }
  }

  function setTool(next) {
    tool = next;
    syncToolbar();
  }

  function showBanner(on, text) {
    if (!banner) return;
    if (text) banner.textContent = text;
    else if (bannerText) banner.textContent = bannerText;
    banner.classList.toggle('show', on);
  }

  function redrawInk() {
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    inkCtx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);
    for (const s of strokes) drawStroke(s);
    if (currentStroke) drawStroke(currentStroke);
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawStroke(s) {
    inkCtx.save();
    inkCtx.strokeStyle = s.color || activeColor;
    inkCtx.fillStyle = s.color || activeColor;
    inkCtx.lineWidth = s.width || 3;
    inkCtx.lineCap = 'round';
    inkCtx.lineJoin = 'round';

    if (s.type === 'pen' && s.points?.length) {
      inkCtx.beginPath();
      inkCtx.moveTo(s.points[0][0], s.points[0][1]);
      for (let i = 1; i < s.points.length; i++) {
        inkCtx.lineTo(s.points[i][0], s.points[i][1]);
      }
      inkCtx.stroke();
    } else if (s.type === 'arrow' && s.from && s.to) {
      drawArrow(s.from, s.to, s.color || activeColor);
    } else if (s.type === 'box' && s.from && s.to) {
      const x = Math.min(s.from[0], s.to[0]);
      const y = Math.min(s.from[1], s.to[1]);
      inkCtx.strokeRect(x, y, Math.abs(s.to[0] - s.from[0]), Math.abs(s.to[1] - s.from[1]));
    }
    inkCtx.restore();
  }

  function drawArrow(from, to, color) {
    const [x1, y1] = from;
    const [x2, y2] = to;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 14;
    inkCtx.strokeStyle = color;
    inkCtx.fillStyle = color;
    inkCtx.beginPath();
    inkCtx.moveTo(x1, y1);
    inkCtx.lineTo(x2, y2);
    inkCtx.stroke();
    inkCtx.beginPath();
    inkCtx.moveTo(x2, y2);
    inkCtx.lineTo(x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4));
    inkCtx.lineTo(x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4));
    inkCtx.closePath();
    inkCtx.fill();
  }

  function startPen(x, y, color) {
    currentStroke = { type: 'pen', points: [[x, y]], color: color || activeColor, width: 3 };
  }

  function extendPen(x, y) {
    if (!currentStroke) return startPen(x, y, activeColor);
    const pts = currentStroke.points;
    const last = pts[pts.length - 1];
    if (last[0] === x && last[1] === y) return;
    pts.push([x, y]);
    redrawInk();
  }

  function finishStroke() {
    if (!currentStroke) {
      if (arrowStart && lastInkPoint && tool === 'arrow') {
        strokes.push({
          type: 'arrow',
          from: arrowStart,
          to: [lastInkPoint.x, lastInkPoint.y],
          color: activeColor,
        });
        arrowStart = null;
        redrawInk();
      } else if (boxStart && lastInkPoint && tool === 'box') {
        strokes.push({
          type: 'box',
          from: boxStart,
          to: [lastInkPoint.x, lastInkPoint.y],
          color: activeColor,
        });
        boxStart = null;
        redrawInk();
      }
      return;
    }
    if (currentStroke.points?.length > 1) strokes.push(currentStroke);
    currentStroke = null;
    redrawInk();
  }

  function undo() {
    strokes.pop();
    redrawInk();
  }

  function clearAll() {
    strokes = [];
    currentStroke = null;
    laserTrails.clear();
    clearCursorHint();
    resetView();
  }

  function addLaserPoint(x, y, participantId) {
    const key = participantId || '__host__';
    const now = performance.now();
    laserTrails.set(key, [{ x, y, t: now }]);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function drawLaser() {
    const now = performance.now();
    laserCtx.clearRect(0, 0, laserCanvas.width, laserCanvas.height);

    for (const [key, trail] of laserTrails) {
      const filtered = trail.filter((p) => now - p.t < LASER_FADE_MS);
      laserTrails.set(key, filtered);
      const color = key === '__host__' ? activeColor : colorForParticipant(key);
      const { r, g, b } = hexToRgb(color);

      for (const p of filtered) {
        const age = (now - p.t) / LASER_FADE_MS;
        const alpha = 1 - age;
        // Bright red laser dot with white-hot center
        laserCtx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`;
        laserCtx.shadowBlur = 16;
        laserCtx.beginPath();
        laserCtx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        laserCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`;
        laserCtx.fill();
        laserCtx.shadowBlur = 0;
        laserCtx.beginPath();
        laserCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        laserCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.95})`;
        laserCtx.fill();
        laserCtx.beginPath();
        laserCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        laserCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        laserCtx.fill();
      }
    }

    if (cursorHint) {
      const age = now - cursorHint.t;
      if (age < CURSOR_FADE_MS) {
        const alpha = 1 - age / CURSOR_FADE_MS;
        if (cursorHint.kind === 'pen') {
          drawPenCursor(laserCtx, cursorHint.x, cursorHint.y, alpha);
        } else {
          drawEraseCursor(laserCtx, cursorHint.x, cursorHint.y, alpha);
        }
      } else {
        cursorHint = null;
      }
    }

    animId = requestAnimationFrame(drawLaser);
  }

  function redrawInkWithPreview(from, to, type) {
    redrawInk();
    inkCtx.save();
    inkCtx.strokeStyle = activeColor;
    inkCtx.fillStyle = activeColor;
    inkCtx.lineWidth = 3;
    if (type === 'arrow') drawArrow(from, to, activeColor);
    else {
      const x = Math.min(from[0], to[0]);
      const y = Math.min(from[1], to[1]);
      inkCtx.strokeRect(x, y, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    }
    inkCtx.restore();
  }

  function handleGesture(msg) {
    const { nx, ny, gesture, participantId, pinchSep } = msg;
    if (mode === 'off') return;

    activeColor = colorForParticipant(participantId);

    if (gesture === 'TWO_HAND_PINCH' && pinchSep != null) {
      if (lastTwoHandSep != null) {
        const ratio = pinchSep / lastTwoHandSep;
        viewScale = Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, viewScale * ratio));
        redrawInk();
      }
      lastTwoHandSep = pinchSep;
      prevGesture = gesture;
      return;
    }
    lastTwoHandSep = null;

    if (gesture === 'THUMBS_UP') {
      dispatchSlideKey('next');
      showBanner(true, 'Next slide');
      setTimeout(() => showBanner(false), 800);
      prevGesture = gesture;
      return;
    }

    if (gesture === 'THUMBS_DOWN') {
      dispatchSlideKey('prev');
      showBanner(true, 'Previous slide');
      setTimeout(() => showBanner(false), 800);
      prevGesture = gesture;
      return;
    }

    if (gesture === 'THREE_FINGER') {
      if (mode === 'off') return;
      const next = mode === 'pointer' ? 'write' : 'pointer';
      setMode(next);
      showBanner(true, next === 'write' ? 'Write mode' : 'Pointer mode');
      setTimeout(() => showBanner(false), 1200);
      prevGesture = gesture;
      return;
    }

    if (gesture === 'OPEN_PALM') {
      if (!openPalmSince) openPalmSince = performance.now();
      if (performance.now() - openPalmSince >= OPEN_PALM_RESET_MS) {
        resetView();
        openPalmSince = null;
        showBanner(true, 'View reset');
        setTimeout(() => showBanner(false), 1200);
      }
      pinchPanAnchor = null;
      prevGesture = gesture;
      return;
    }
    openPalmSince = null;

    if (gesture === 'FIST') {
      finishStroke();
      pinchPanAnchor = null;
      clearCursorHint();
      prevGesture = gesture;
      return;
    }

    if (gesture === 'ERASE') {
      if (mode !== 'write') {
        clearCursorHint();
        prevGesture = gesture;
        return;
      }
      finishStroke();
      if (nx != null && ny != null) {
        const pt = normToScreen(nx, ny);
        setCursorHint(pt.x, pt.y, 'erase');
        const inkPt = screenToInk(pt.x, pt.y);
        eraseStrokesAt(inkPt.x, inkPt.y);
      } else {
        undo();
      }
      pinchPanAnchor = null;
      prevGesture = gesture;
      return;
    }

    if (gesture === 'PINCH' && nx != null && ny != null) {
      const pt = normToScreen(nx, ny);
      lastPoint = pt;
      if (mode === 'pointer') {
        addLaserPoint(pt.x, pt.y, participantId);
      } else if (mode === 'write') {
        if (!pinchPanAnchor) {
          pinchPanAnchor = { x: pt.x, y: pt.y, ox: viewOffsetX, oy: viewOffsetY };
        } else {
          viewOffsetX = pinchPanAnchor.ox + (pt.x - pinchPanAnchor.x);
          viewOffsetY = pinchPanAnchor.oy + (pt.y - pinchPanAnchor.y);
          redrawInk();
        }
      }
      prevGesture = gesture;
      return;
    }

    if (prevGesture === 'PINCH' && gesture !== 'PINCH') {
      pinchPanAnchor = null;
    }
    prevGesture = gesture;

    if (gesture !== 'DRAW' || nx == null || ny == null) return;

    const pt = normToScreen(nx, ny);
    lastPoint = pt;
    const inkPt = screenToInk(pt.x, pt.y);
    lastInkPoint = inkPt;

    if (mode === 'pointer') {
      clearCursorHint();
      addLaserPoint(pt.x, pt.y, participantId);
      return;
    }

    if (mode === 'write') {
      setCursorHint(pt.x, pt.y, 'pen');
      if (tool === 'pen') {
        extendPen(inkPt.x, inkPt.y);
      } else if (tool === 'arrow') {
        if (!arrowStart) arrowStart = [inkPt.x, inkPt.y];
        else redrawInkWithPreview(arrowStart, [inkPt.x, inkPt.y], 'arrow');
      } else if (tool === 'box') {
        if (!boxStart) boxStart = [inkPt.x, inkPt.y];
        else redrawInkWithPreview(boxStart, [inkPt.x, inkPt.y], 'box');
      }
    }
  }

  function getExportPayload() {
    redrawInk();
    return {
      inkDataUrl: inkCanvas.toDataURL('image/png'),
      strokesJson: JSON.stringify(strokes, null, 2),
      strokeCount: strokes.length,
    };
  }

  function destroy() {
    cancelAnimationFrame(animId);
    clearAll();
  }

  window.addEventListener('resize', resize);
  resize();
  drawLaser();

  if (toolbar) {
    toolbar.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMode(btn.dataset.mode);
      });
    });
    toolbar.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool(btn.dataset.tool);
      });
    });
    syncToolbar();
  }

  return {
    setMode,
    setTool,
    showBanner,
    handleGesture,
    clearAll,
    destroy,
    getExportPayload,
    resize,
    getMode: () => mode,
    getTool: () => tool,
  };
}
