// GestureCanvas — main engine
// Camera / webcam requires HTTPS or localhost to work.

import {
  classifyGesture,
  GestureSmoother,
  PointSmoother,
  Gesture,
  isPinchPose,
  isFistPose,
  isOpenPalmPose,
  isPausePose,
  handScale,
} from './gestureClassifier.js';
import {
  classifyStroke,
  getCanonicalRenderer,
  ShapeType,
} from './shapeRecognizer.js';
import { loadPdfFile, renderAllPdfPages } from './pdfImporter.js';
// ─── DOM references ───────────────────────────────────────────────────────────

const canvasArea = document.getElementById('canvas-area');
const mainCanvas = document.getElementById('main-canvas');
const handCanvas = document.getElementById('hand-canvas');
const ctx = mainCanvas.getContext('2d');
const handCtx = handCanvas.getContext('2d');

const toolButtons = document.querySelectorAll('.tool-btn[data-mode]');
const swatches = document.querySelectorAll('.swatch[data-color]');
const strokeSizeInput = document.getElementById('stroke-size');
const strokeLabel = document.getElementById('stroke-label');
const btnSnapCircle = document.getElementById('btn-snap-circle');
const btnSnapRect = document.getElementById('btn-snap-rect');
const btnSnapLine = document.getElementById('btn-snap-line');
const btnAutoSnap = document.getElementById('btn-auto-snap');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const btnRecognize = document.getElementById('btn-recognize');
const gestureLabel = document.getElementById('gesture-label');
const fpsCounter = document.getElementById('fps-counter');
const modeIndicator = document.getElementById('mode-indicator');
const ocrOverlay = document.getElementById('ocr-overlay');
const ocrResult = document.getElementById('ocr-result');
const ocrClose = document.getElementById('ocr-close');
const ocrReplace = document.getElementById('ocr-replace');
const cameraMirror = document.getElementById('camera-mirror');
const mirrorHotspot = document.getElementById('mirror-hotspot');
const mirrorHotspotRing = document.getElementById('mirror-hotspot-ring');
const btnCameraToggle = document.getElementById('btn-camera-toggle');
const btnImportPdf = document.getElementById('btn-import-pdf');
const pdfFileInput = document.getElementById('pdf-file-input');
const pdfImportMeta = document.getElementById('pdf-import-meta');
const btnPdfFullscreen = document.getElementById('btn-pdf-fullscreen');
const btnPdfExit = document.getElementById('btn-pdf-exit');
const pdfFullscreenUi = document.getElementById('pdf-fullscreen-ui');
const btnPdfFsClose = document.getElementById('btn-pdf-fs-close');
const fsStrokeSizeInput = document.getElementById('fs-stroke-size');
const fsStrokeLabel = document.getElementById('fs-stroke-label');
const fsSwatches = document.querySelectorAll('.fs-swatch[data-color]');
const pipWebcam = document.getElementById('pip-webcam');

const PDF_FS_TOOLBAR_W = 216;

// ─── Application state ────────────────────────────────────────────────────────

const strokes = [];
let activeMode = 'draw';
let activeColor = '#FFD700';
let activeWidth = 12;

let isPointerDown = false;
let currentStroke = null;

const HAND_POINTER_COLORS = ['#38bdf8', '#f472b6'];
const FINGER_TIPS = [
  { idx: 4, pip: 3, label: 'T', isThumb: true },
  { idx: 8, pip: 6, label: 'I' },
  { idx: 12, pip: 10, label: 'M' },
  { idx: 16, pip: 14, label: 'R' },
  { idx: 20, pip: 18, label: 'P' },
];

function createHandState() {
  return {
    gestureSmoother: new GestureSmoother(5),
    pointSmoother: new PointSmoother(0.52),
    currentStroke: null,
    isDrawing: false,
    prevGesture: Gesture.UNKNOWN,
    holdSnapPoint: null,
    openPalmHoldStart: null,
    stableFrameCount: 0,
    armed: false,
    lostFrames: 0,
    drawExitFrames: 0,
    unstableFrames: 0,
    lastDrawPoint: null,
    lastDrawTime: 0,
    lastWrist: null,
    lastHandScale: null,
  };
}

const handStates = [createHandState(), createHandState()];
const slotWristMemory = [null, null];

let zoomScale = 1;
let zoomTx = 0;
let zoomTy = 0;
let zoomRotation = 0;
let lastPinchDistance = null;
let lastPinchAngle = null;
let smoothedPinchDistance = null;
let smoothedPinchAngle = null;
let isPinchZooming = false;
let stableTwoHandFrames = 0;
let lostHandFrames = 0;
let noHandFrames = 0;
const TWO_HAND_STABLE_FRAMES = 1;
const ONE_HAND_EXIT_FRAMES = 6;
const NO_HAND_RESET_FRAMES = 12;
const HAND_WARMUP_FRAMES = 1;
const HAND_LOST_GRACE_FRAMES = 18;
const DRAW_EXIT_FRAMES = 8;
const MAX_POINT_JUMP_BASE = 72;
const MAX_WRIST_JUMP_DRAW = 0.34;
const MAX_WRIST_JUMP_IDLE = 0.24;
const UNSTABLE_FINISH_FRAMES = 28;
const PINCH_MOVE_THRESHOLD = 8;
const TWO_HAND_PINCH_MOVE_THRESHOLD = 3;
const PINCH_SMOOTH_ALPHA = 0.35;
const MAX_ZOOM_RATIO_DELTA = 0.06;
const MAX_ROT_DELTA = 0.08;

let dragState = {
  active: false,
  stroke: null,
  lastX: 0,
  lastY: 0,
  handIndex: -1,
  scrollVelocity: 0,
  lastScrollTime: 0,
};

const pdfScrollMomentum = {
  pdf: null,
  velocity: 0,
  rafId: null,
};

const pdfViewerState = {
  stroke: null,
  fullscreen: false,
};

let lastPdfScrollMidY = null;
let lastPdfPinchDistance = null;
let smoothedPdfPinchDistance = null;
const PDF_ZOOM_MIN = 0.6;
const PDF_ZOOM_MAX = 4;
const PDF_ZOOM_SMOOTH = 0.38;
const PDF_DEFAULT_ZOOM = 0.8;
const PDF_SCROLL_SENSITIVITY = 3.5;
const PDF_SCROLL_FRICTION = 0.88;
const PDF_SCROLL_MOMENTUM_MIN = 0.6;
const PDF_SCROLL_MOMENTUM_MAX = 110;
const PDF_EMBEDDED_HIT_RADIUS = 120;
const PDF_FULLSCREEN_HIT_PAD = 72;

const HOLD_MOVE_THRESHOLD = 12;

function handleOpenPalmHold(state, gesture, now) {
  if (gesture === Gesture.OPEN_PALM) {
    if (!state.openPalmHoldStart) state.openPalmHoldStart = now;
    if (now - state.openPalmHoldStart >= 1000) {
      resetZoom();
      state.openPalmHoldStart = null;
    }
  } else {
    state.openPalmHoldStart = null;
  }
}

/** Immediate pause from raw pose — avoids smoother lag on fist / open palm */
function handlePauseGestures(handData, now) {
  for (const info of handData) {
    if (!isPausePose(info.landmarks)) continue;

    const state = handStates[info.handIndex];
    const openPalm = isOpenPalmPose(info.landmarks);

    pauseOrFinishHandStroke(info.handIndex);
    if (dragState.handIndex === info.handIndex) endPinchDrag();

    if (openPalm) {
      handleOpenPalmHold(state, Gesture.OPEN_PALM, now);
      state.prevGesture = Gesture.OPEN_PALM;
    } else {
      handleOpenPalmHold(state, Gesture.FIST, now);
      state.prevGesture = Gesture.FIST;
    }
  }
}

function pauseOrFinishHandStroke(handIndex) {
  const state = handStates[handIndex];
  if (state.currentStroke || state.isDrawing) {
    finishHandStroke(handIndex);
  }
  resetHandHoldSnap(state);
}

function setupPointerOverlay() {
  handCanvas.style.position = 'absolute';
  handCanvas.style.inset = '0';
  handCanvas.style.width = '100%';
  handCanvas.style.height = '100%';
  handCanvas.style.pointerEvents = 'none';
  handCanvas.style.zIndex = '2';
  canvasArea.appendChild(handCanvas);
}

function setupCameraMirror() {
  const video = document.getElementById('webcam');
  if (cameraMirror && video && video.parentElement !== cameraMirror) {
    cameraMirror.appendChild(video);
  }
}

function toggleCameraMirror(force) {
  mirrorEnabled = typeof force === 'boolean' ? force : !mirrorEnabled;
  const video = document.getElementById('webcam');

  cameraMirror?.classList.toggle('active', mirrorEnabled);
  mainCanvas.classList.toggle('mirror-on', mirrorEnabled);
  btnCameraToggle?.classList.toggle('active', mirrorEnabled);

  if (video) {
    video.style.display = mirrorEnabled ? 'block' : 'none';
  }

  if (btnCameraToggle) {
    btnCameraToggle.textContent = '';
    btnCameraToggle.setAttribute('aria-pressed', mirrorEnabled ? 'true' : 'false');
    btnCameraToggle.classList.toggle('active', mirrorEnabled);
  }

  redraw();
}

function canvasPointToClient(x, y) {
  const rect = mainCanvas.getBoundingClientRect();
  return {
    x: rect.left + (x / mainCanvas.width) * rect.width,
    y: rect.top + (y / mainCanvas.height) * rect.height,
  };
}

function landmarkToClient(lm) {
  const app = document.getElementById('app');
  const rect = app.getBoundingClientRect();
  return {
    x: rect.left + (1 - lm.x) * rect.width,
    y: rect.top + lm.y * rect.height,
  };
}

function isTipOverElement(landmarks, el, useAppCoords = false) {
  if (!el) return false;
  const client = useAppCoords
    ? landmarkToClient(landmarks[8])
    : canvasPointToClient(landmarkToCanvas(landmarks[8]).x, landmarkToCanvas(landmarks[8]).y);
  const r = el.getBoundingClientRect();
  return (
    client.x >= r.left &&
    client.x <= r.right &&
    client.y >= r.top &&
    client.y <= r.bottom
  );
}

function resetMirrorHover() {
  mirrorHoverStart = null;
  mirrorHotspot?.classList.remove('hovering');
  if (mirrorHotspotRing) {
    mirrorHotspotRing.style.opacity = '0';
    mirrorHotspotRing.style.transform = 'rotate(-90deg)';
  }
}

function updateMirrorGestureToggle(handData, now) {
  if (!handData.length) {
    resetMirrorHover();
    return;
  }

  const overTarget = handData.some(
    ({ landmarks }) =>
      isTipOverElement(landmarks, mirrorHotspot, false) ||
      isTipOverElement(landmarks, btnCameraToggle, true),
  );

  if (!overTarget) {
    resetMirrorHover();
    return;
  }

  mirrorHotspot?.classList.add('hovering');
  if (!mirrorHoverStart) mirrorHoverStart = now;

  const progress = Math.min(1, (now - mirrorHoverStart) / MIRROR_HOTSPOT_MS);
  if (mirrorHotspotRing) {
    mirrorHotspotRing.style.opacity = '1';
    mirrorHotspotRing.style.transform = `rotate(${progress * 360 - 90}deg)`;
  }

  if (progress >= 1) {
    toggleCameraMirror();
    resetMirrorHover();
    gestureLabel.textContent = mirrorEnabled ? 'Mirror on' : 'Mirror off';
  }
}

function isFingerExtended(landmarks, tipIdx, pipIdx, isThumb = false) {
  if (isThumb) {
    return Math.abs(landmarks[4].x - landmarks[2].x) >
      Math.abs(landmarks[3].x - landmarks[2].x) * 0.5;
  }
  return landmarks[tipIdx].y < landmarks[pipIdx].y;
}

function getHandednessEntry(handedness, index) {
  const raw = handedness?.[index];
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function getHandLabel(results, handIndex) {
  const entry = getHandednessEntry(results.multiHandedness, handIndex);
  const label = entry?.displayName || entry?.label;
  if (label) return label.charAt(0).toUpperCase();
  return `H${handIndex + 1}`;
}

function classifyHand(landmarks, state, score = 1) {
  const classified = classifyGesture(landmarks);
  const rawGesture = classified.gesture;
  const pinching = isPinchPose(landmarks);
  const trackingOk = isHandTrackingStable(landmarks, state, score);

  if (trackingOk) {
    state.lastWrist = { x: landmarks[0].x, y: landmarks[0].y };
    state.lastHandScale = handScale(landmarks);
    state.unstableFrames = 0;
  } else if (state.isDrawing) {
    state.unstableFrames++;
  }

  // While drawing, keep following index tip even during fast motion
  if (state.isDrawing) {
    const indexUp = isFingerExtended(landmarks, 8, 6);
    const middleUp = isFingerExtended(landmarks, 12, 10);
    const ringUp = isFingerExtended(landmarks, 16, 14);
    if (indexUp && !middleUp && !ringUp && !isPausePose(landmarks)) {
      const tip = mediaPipePointToCanvas(landmarks[8].x, landmarks[8].y);
      const drawPoint = sanitizeDrawPoint(state, state.pointSmoother.smooth(tip));
      if (drawPoint) {
        state.lastWrist = { x: landmarks[0].x, y: landmarks[0].y };
        state.lastHandScale = handScale(landmarks);
        state.unstableFrames = 0;
      } else if (!trackingOk) {
        state.unstableFrames++;
      }
      return {
        gesture: Gesture.DRAW,
        drawPoint,
        classified,
        pinching,
        landmarks,
        trackingOk: !!drawPoint,
      };
    }
  }

  state.gestureSmoother.push(rawGesture);
  let gesture = state.gestureSmoother.get();

  // Pinch takes priority over smoother lag
  if (pinching) {
    gesture = Gesture.PINCH;
  }

  let drawPoint = null;

  if (pinching || gesture === Gesture.PINCH) {
    drawPoint = state.pointSmoother.smooth(pinchLandmarksToCanvas(landmarks));
  } else if (classified.drawPoint && trackingOk) {
    const pt = mediaPipePointToCanvas(classified.drawPoint.x, classified.drawPoint.y);
    drawPoint = sanitizeDrawPoint(state, state.pointSmoother.smooth(pt));
  } else if (!state.isDrawing) {
    state.pointSmoother.reset();
  }

  return { gesture, drawPoint, classified, pinching, landmarks, trackingOk };
}

/** Reject only extreme teleports; clamp fast motion instead of dropping frames */
function sanitizeDrawPoint(state, drawPoint, now = performance.now()) {
  if (!drawPoint) return null;
  if (!isCanvasPointSane(drawPoint)) return null;
  if (!state.lastDrawPoint) {
    state.lastDrawTime = now;
    return drawPoint;
  }

  const dt = Math.max(10, now - (state.lastDrawTime || now));
  const maxJump = MAX_POINT_JUMP_BASE * (dt / 33);
  const dx = drawPoint.x - state.lastDrawPoint.x;
  const dy = drawPoint.y - state.lastDrawPoint.y;
  const jump = Math.hypot(dx, dy);

  if (jump <= maxJump) {
    state.lastDrawTime = now;
    return drawPoint;
  }

  // Fast swipe — step toward target instead of losing the frame
  if (state.isDrawing && jump < maxJump * 4) {
    const t = maxJump / jump;
    state.lastDrawTime = now;
    return {
      x: state.lastDrawPoint.x + dx * t,
      y: state.lastDrawPoint.y + dy * t,
    };
  }

  return null;
}

function isCanvasPointSane(pt) {
  const margin = 4;
  return (
    pt.x >= -margin &&
    pt.x <= mainCanvas.width + margin &&
    pt.y >= -margin &&
    pt.y <= mainCanvas.height + margin
  );
}

function isWristOnScreen(wrist) {
  return wrist.x >= -0.15 && wrist.x <= 1.15 && wrist.y >= -0.15 && wrist.y <= 1.15;
}

function isWristNearEdge(wrist) {
  return wrist.x < 0.18 || wrist.x > 0.82 || wrist.y < 0.18 || wrist.y > 0.82;
}

function isNearKnownWrist(wrist) {
  for (const mem of slotWristMemory) {
    if (!mem) continue;
    if (dist(wrist.x, wrist.y, mem.x, mem.y) < 0.24) return true;
  }
  return false;
}

function isLandmarkFrameSane(landmarks, relaxed = false) {
  if (!landmarks || landmarks.length < 21) return false;

  const wrist = landmarks[0];
  if (!isWristOnScreen(wrist)) return false;

  // Fingertips often exceed [0,1] when the hand sits on screen edges — allow that
  let farOut = 0;
  for (const lm of landmarks) {
    if (lm.x < -0.4 || lm.x > 1.4 || lm.y < -0.4 || lm.y > 1.4) farOut++;
  }
  if (farOut > 6) return false;

  const atEdge = isWristNearEdge(wrist);
  const scale = handScale(landmarks);
  if (scale < 0.018 || scale > (atEdge ? 0.72 : 0.55)) return false;

  const indexReach =
    dist(landmarks[5].x, landmarks[5].y, landmarks[8].x, landmarks[8].y) / scale;
  const minReach = atEdge || relaxed ? 0.16 : 0.26;
  const maxReach = atEdge || relaxed ? 2.1 : 1.65;
  if (indexReach < minReach || indexReach > maxReach) return false;

  return true;
}

function isHandTrackingStable(landmarks, state, score) {
  const relaxed = state.isDrawing;
  if (!isLandmarkFrameSane(landmarks, relaxed)) return false;

  const atEdge = isWristNearEdge(landmarks[0]);
  const minScore = atEdge || relaxed ? 0.38 : 0.55;
  if (typeof score === 'number' && score > 0 && score < minScore) return false;

  // Near screen edges, wrist jump / scale jitter is expected — keep following the hand
  if (!atEdge) {
    const wrist = landmarks[0];
    const scale = handScale(landmarks);
    const jumpLimit = relaxed ? MAX_WRIST_JUMP_DRAW : MAX_WRIST_JUMP_IDLE;

    if (state.lastWrist) {
      const wristJump = dist(wrist.x, wrist.y, state.lastWrist.x, state.lastWrist.y);
      if (wristJump > jumpLimit) {
        if (!(relaxed && wristJump < jumpLimit * 2.2)) return false;
      }
    }

    if (state.lastHandScale) {
      const ratio = scale / state.lastHandScale;
      const minRatio = relaxed ? 0.45 : 0.55;
      const maxRatio = relaxed ? 2.1 : 1.75;
      if (ratio < minRatio || ratio > maxRatio) return false;
    }
  }

  return true;
}

function getHandConfidence(handedness, index) {
  return getHandednessEntry(handedness, index)?.score ?? 1;
}

/** Filter obviously bad landmark frames — common when hand covers face */
function isValidHandLandmarks(landmarks, score, relaxed = false) {
  if (!isLandmarkFrameSane(landmarks, relaxed)) return false;
  const atEdge = isWristNearEdge(landmarks[0]);
  const minScore = atEdge || relaxed ? 0.32 : 0.45;
  if (typeof score === 'number' && score > 0 && score < minScore) return false;
  return true;
}

function filterValidHands(handEntries, handedness) {
  if (!handEntries?.length) return [];
  const relaxedDraw = handStates.some((s) => s.isDrawing);
  const valid = [];
  for (const { landmarks, sourceIndex } of handEntries) {
    const score = getHandConfidence(handedness, sourceIndex);
    const keepRelaxed = relaxedDraw || isNearKnownWrist(landmarks[0]);
    if (isValidHandLandmarks(landmarks, score, keepRelaxed)) {
      valid.push({ landmarks, sourceIndex });
    }
  }
  return valid;
}

/** Normalized midpoint between thumb and index tips */
function pinchMidpoint(landmarks) {
  return {
    x: (landmarks[8].x + landmarks[4].x) / 2,
    y: (landmarks[8].y + landmarks[4].y) / 2,
  };
}

/** MediaPipe sometimes reports one hand twice — never merge two real pinching hands */
function dedupeHandLandmarks(multi, handedness) {
  if (!multi?.length) return [];
  if (multi.length < 2) {
    return multi.map((landmarks, sourceIndex) => ({ landmarks, sourceIndex }));
  }

  const pinchA = isPinchPose(multi[0]);
  const pinchB = isPinchPose(multi[1]);
  if (pinchA && pinchB) {
    return multi.map((landmarks, sourceIndex) => ({ landmarks, sourceIndex }));
  }

  const wristDist = dist(multi[0][0].x, multi[0][0].y, multi[1][0].x, multi[1][0].y);
  if (wristDist > 0.14) {
    return multi.map((landmarks, sourceIndex) => ({ landmarks, sourceIndex }));
  }

  let avgDist = 0;
  for (let i = 0; i < 21; i++) {
    avgDist += dist(multi[0][i].x, multi[0][i].y, multi[1][i].x, multi[1][i].y);
  }
  avgDist /= 21;

  if (avgDist > 0.1) {
    return multi.map((landmarks, sourceIndex) => ({ landmarks, sourceIndex }));
  }

  const score0 = getHandConfidence(handedness, 0);
  const score1 = getHandConfidence(handedness, 1);
  return score0 >= score1
    ? [{ landmarks: multi[0], sourceIndex: 0 }]
    : [{ landmarks: multi[1], sourceIndex: 1 }];
}

/** Keep both hands when each is pinching — relaxed validation for two-hand zoom */
function retainTwoPinchingHands(handEntries, handedness) {
  if (handEntries.length < 2) return null;

  const pinching = handEntries.filter((e) => isPinchPose(e.landmarks));
  if (pinching.length < 2) return null;

  const kept = [];
  for (const entry of handEntries) {
    const score = getHandConfidence(handedness, entry.sourceIndex);
    const wrist = entry.landmarks[0];
    if (!isWristOnScreen(wrist)) continue;
    if (typeof score === 'number' && score > 0 && score < 0.22) continue;
    kept.push(entry);
  }

  return kept.length >= 2 ? kept.slice(0, 2) : null;
}

/** While drawing with one hand, ignore phantom second-hand detections */
function preferSingleHandWhileDrawing(validHands) {
  if (validHands.length <= 1) return validHands;

  const bothPinching =
    validHands.length >= 2 && validHands.every((h) => isPinchPose(h.landmarks));
  if (bothPinching) return validHands;

  const drawingSlot = handStates.findIndex((s) => s.isDrawing);
  if (drawingSlot < 0) return validHands;

  const memory = slotWristMemory[drawingSlot];
  if (!memory) return [validHands[0]];

  let best = validHands[0];
  let bestDist = Infinity;
  for (const hand of validHands) {
    const wrist = hand.landmarks[0];
    const d = dist(wrist.x, wrist.y, memory.x, memory.y);
    if (d < bestDist) {
      bestDist = d;
      best = hand;
    }
  }
  return [best];
}

/** Keep stable slot assignment so hand identity doesn't flip mid-stroke */
function assignHandSlots(validHands) {
  if (validHands.length === 0) return [];
  if (validHands.length === 1) {
    return [{ ...validHands[0], slotIndex: 0 }];
  }

  const hands = validHands.map((hand) => ({
    ...hand,
    wrist: hand.landmarks[0],
  }));

  const assignments = [];
  const used = new Set();

  for (let slot = 0; slot < 2; slot++) {
    const memory = slotWristMemory[slot];
    if (!memory) continue;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < hands.length; i++) {
      if (used.has(i)) continue;
      const d = dist(hands[i].wrist.x, hands[i].wrist.y, memory.x, memory.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDist < 0.3) {
      used.add(bestIdx);
      assignments.push({ ...hands[bestIdx], slotIndex: slot });
    }
  }

  for (let i = 0; i < hands.length; i++) {
    if (used.has(i)) continue;
    const freeSlot = assignments.some((a) => a.slotIndex === 0) ? 1 : 0;
    if (!assignments.some((a) => a.slotIndex === freeSlot)) {
      assignments.push({ ...hands[i], slotIndex: freeSlot });
      used.add(i);
    }
  }

  return assignments.length ? assignments : [{ ...hands[0], slotIndex: 0 }];
}

function updateSlotWristMemory(handData) {
  for (const { landmarks, handIndex } of handData) {
    slotWristMemory[handIndex] = { x: landmarks[0].x, y: landmarks[0].y };
  }
}

function areDistinctRealHands(multi) {
  if (!multi || multi.length < 2) return false;

  const pinchA = pinchMidpoint(multi[0]);
  const pinchB = pinchMidpoint(multi[1]);
  const pinchSep = dist(pinchA.x, pinchA.y, pinchB.x, pinchB.y);
  if (pinchSep > 0.035) return true;

  const wristDist = dist(multi[0][0].x, multi[0][0].y, multi[1][0].x, multi[1][0].y);
  return wristDist > 0.04;
}

function isHandPinching(handInfo) {
  if (!handInfo?.landmarks) return false;
  return (
    handInfo.pinching ||
    handInfo.gesture === Gesture.PINCH ||
    isPinchPose(handInfo.landmarks)
  );
}

function shouldTwoHandTransform(multi, handData) {
  if (handData.length < 2) return false;
  if (!handData.every((h) => isHandPinching(h))) return false;
  if (isPinchZooming) return true;
  return areDistinctRealHands(multi);
}

function getPinchCanvasPoint(landmarks) {
  return pinchLandmarksToCanvas(landmarks);
}

function isSingleHandPinch(info) {
  return isHandPinching(info);
}

function getPinchPointForHand(info) {
  return info.drawPoint || pinchLandmarksToCanvas(info.landmarks);
}

function drawFingerPointers(handData) {
  for (const { landmarks, handIndex, gesture, drawPoint, label } of handData) {
    const color = HAND_POINTER_COLORS[handIndex % HAND_POINTER_COLORS.length];
    const isActive = gesture === Gesture.DRAW || gesture === Gesture.ERASE;

    for (const finger of FINGER_TIPS) {
      if (!isFingerExtended(landmarks, finger.idx, finger.pip, finger.isThumb)) continue;

      const tip = landmarkToCanvas(landmarks[finger.idx]);
      const isPenFinger = finger.idx === 8;
      const radius = isPenFinger && isActive ? 6 : 4;

      handCtx.beginPath();
      handCtx.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
      handCtx.fillStyle = isPenFinger && isActive ? color : `${color}88`;
      handCtx.fill();

      if (!isPenFinger || !isActive) {
        handCtx.font = 'bold 9px sans-serif';
        handCtx.fillStyle = '#fff';
        handCtx.textAlign = 'center';
        handCtx.textBaseline = 'middle';
        handCtx.fillText(finger.label, tip.x, tip.y);
      }
    }

    if (drawPoint) {
      handCtx.beginPath();
      handCtx.arc(drawPoint.x, drawPoint.y, 14, 0, Math.PI * 2);
      handCtx.strokeStyle = color;
      handCtx.lineWidth = 2.5;
      handCtx.stroke();

      handCtx.beginPath();
      handCtx.arc(drawPoint.x, drawPoint.y, 4, 0, Math.PI * 2);
      handCtx.fillStyle = color;
      handCtx.fill();
    }

    const wrist = landmarkToCanvas(landmarks[0]);
    handCtx.font = 'bold 11px sans-serif';
    handCtx.fillStyle = color;
    handCtx.textAlign = 'center';
    handCtx.textBaseline = 'bottom';
    handCtx.fillText(label, wrist.x, wrist.y - 10);
  }
}

function drawPipSkeleton(landmarks, connections, drawConnectors, drawLandmarks) {
  const pipW = 200;
  const pipH = 150;
  const ox = mainCanvas.width - pipW - 8;
  const oy = mainCanvas.height - pipH - 52;
  const scale = Math.min(pipW / mainCanvas.width, pipH / mainCanvas.height);

  handCtx.save();
  handCtx.translate(ox, oy);
  handCtx.scale(scale, scale);
  const mirrored = mirrorLandmarks(landmarks);
  drawConnectors(handCtx, mirrored, connections, { color: '#38bdf844', lineWidth: 2 });
  drawLandmarks(handCtx, mirrored, { color: '#f472b666', lineWidth: 1, radius: 2 });
  handCtx.restore();
}
let lastOcrStrokeIndices = [];
let lastOcrBounds = null;

let mirrorEnabled = false;
let mirrorHoverStart = null;
const MIRROR_HOTSPOT_MS = 1200;

// ─── Camera / coordinate frame ────────────────────────────────────────────────
// Match camera processing to viewport (MacBook Air is 16:10 — e.g. 1440×900, 1470×956).
// Avoids 16:9 (1280×720) vs screen mismatch that shrinks usable gesture area.

function getCameraFrameSize() {
  const w = canvasArea?.clientWidth || window.innerWidth || 1440;
  const h = canvasArea?.clientHeight || window.innerHeight || 900;
  const maxW = 1440;
  const scale = w > maxW ? maxW / w : 1;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

function getVideoFrameSize() {
  const video = document.getElementById('webcam');
  if (video?.videoWidth > 0 && video?.videoHeight > 0) {
    return { w: video.videoWidth, h: video.videoHeight };
  }
  const fallback = getCameraFrameSize();
  return { w: fallback.width, h: fallback.height };
}

function mediaPipePointToCanvas(x, y) {
  return landmarkToCanvas({ x, y });
}

function pinchLandmarksToCanvas(landmarks) {
  const x = (landmarks[8].x + landmarks[4].x) / 2;
  const y = (landmarks[8].y + landmarks[4].y) / 2;
  return mediaPipePointToCanvas(x, y);
}

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas() {
  const w = canvasArea.clientWidth;
  const h = canvasArea.clientHeight;
  mainCanvas.width = w;
  mainCanvas.height = h;
  handCanvas.width = w;
  handCanvas.height = h;
  if (pdfViewerState.stroke) {
    pdfViewerState.stroke._layoutCache = null;
  }
  redraw();
}

// ─── Coordinate helpers ─────────────────────────────────────────────────────────

function clientToCanvas(clientX, clientY) {
  const rect = mainCanvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * mainCanvas.width;
  const y = ((clientY - rect.top) / rect.height) * mainCanvas.height;
  return [x, y];
}

function mirrorLandmarks(landmarks) {
  return landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));
}

function landmarkToCanvas(lm) {
  const cw = mainCanvas.width;
  const ch = mainCanvas.height;
  const { w: vw, h: vh } = getVideoFrameSize();

  if (!vw || !vh || !cw || !ch) {
    return { x: (1 - lm.x) * cw, y: lm.y * ch };
  }

  const videoAR = vw / vh;
  const canvasAR = cw / ch;
  let nx = lm.x;
  let ny = lm.y;

  // Correct for object-fit: cover crop between camera frame and canvas
  if (canvasAR > videoAR) {
    const visible = videoAR / canvasAR;
    const off = (1 - visible) / 2;
    ny = (ny - off) / visible;
  } else if (canvasAR < videoAR) {
    const visible = canvasAR / videoAR;
    const off = (1 - visible) / 2;
    nx = (nx - off) / visible;
  }

  nx = Math.max(-0.08, Math.min(1.08, nx));
  ny = Math.max(-0.08, Math.min(1.08, ny));

  return {
    x: (1 - nx) * cw,
    y: ny * ch,
  };
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

// ─── Drawing helpers ────────────────────────────────────────────────────────────

function drawFreehandPath(context, points, color, width) {
  if (!points || points.length < 1) return;
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    context.arc(points[0][0], points[0][1], Math.max(width * 0.5, 1.5), 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    return;
  }
  context.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i][0], points[i][1]);
  }
  context.stroke();
}

function drawStrokeItem(context, stroke) {
  if (stroke.renderer) {
    stroke.renderer(context, stroke.color, stroke.width);
  } else {
    drawFreehandPath(context, stroke.points, stroke.color, stroke.width);
  }
}

function computePdfFullscreenLayout(pdf) {
  const margin = 20;
  const zoom = pdf.pdfZoom || 1;
  const contentW = (mainCanvas.width - margin * 2 - PDF_FS_TOOLBAR_W) * zoom;
  const layouts = [];
  let totalH = margin;
  for (const page of pdf.pages) {
    const scale = contentW / page.width;
    const h = page.height * scale;
    layouts.push({ y: totalH, w: contentW, h, page });
    totalH += h + 12;
  }
  totalH += margin;
  pdf._layoutCache = { layouts, totalH, margin, contentW, zoom };
  return pdf._layoutCache;
}

function getPdfMaxScroll(pdf) {
  const layout = pdf._layoutCache || computePdfFullscreenLayout(pdf);
  return Math.max(0, layout.totalH - mainCanvas.height);
}

function scrollPdf(pdf, deltaY) {
  if (!deltaY) return;
  pdf.scrollY = Math.max(0, Math.min(getPdfMaxScroll(pdf), pdf.scrollY + deltaY));
  redraw();
}

function stopPdfScrollMomentum() {
  if (pdfScrollMomentum.rafId) {
    cancelAnimationFrame(pdfScrollMomentum.rafId);
    pdfScrollMomentum.rafId = null;
  }
  pdfScrollMomentum.velocity = 0;
  pdfScrollMomentum.pdf = null;
}

function startPdfScrollMomentum(pdf, velocity) {
  stopPdfScrollMomentum();
  if (!pdf?.fullscreen || Math.abs(velocity) < PDF_SCROLL_MOMENTUM_MIN) return;
  pdfScrollMomentum.pdf = pdf;
  pdfScrollMomentum.velocity = Math.max(
    -PDF_SCROLL_MOMENTUM_MAX,
    Math.min(PDF_SCROLL_MOMENTUM_MAX, velocity),
  );
  pdfScrollMomentum.rafId = requestAnimationFrame(stepPdfScrollMomentum);
}

function stepPdfScrollMomentum() {
  const pdf = pdfScrollMomentum.pdf;
  if (!pdf?.fullscreen) {
    stopPdfScrollMomentum();
    return;
  }

  const velocity = pdfScrollMomentum.velocity;
  const before = pdf.scrollY;
  const maxScroll = getPdfMaxScroll(pdf);
  scrollPdf(pdf, velocity);

  const hitTop = pdf.scrollY <= 0 && velocity < 0;
  const hitBottom = pdf.scrollY >= maxScroll && velocity > 0;
  const stuck = pdf.scrollY === before;

  if (hitTop || hitBottom || stuck) {
    stopPdfScrollMomentum();
    return;
  }

  pdfScrollMomentum.velocity *= PDF_SCROLL_FRICTION;
  if (Math.abs(pdfScrollMomentum.velocity) >= PDF_SCROLL_MOMENTUM_MIN) {
    pdfScrollMomentum.rafId = requestAnimationFrame(stepPdfScrollMomentum);
  } else {
    stopPdfScrollMomentum();
  }
}

function drawPdfStroke(context, pdf) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  if (pdf.fullscreen) {
    const layout = computePdfFullscreenLayout(pdf);
    context.save();
    context.fillStyle = 'rgba(10, 12, 18, 0.94)';
    context.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
    for (const item of layout.layouts) {
      const drawY = item.y - pdf.scrollY;
      if (drawY + item.h < 0 || drawY > mainCanvas.height) continue;
      context.fillStyle = '#ffffff';
      context.shadowColor = 'rgba(0,0,0,0.4)';
      context.shadowBlur = 14;
      context.fillRect(layout.margin - 2, drawY - 2, item.w + 4, item.h + 4);
      context.shadowBlur = 0;
      context.drawImage(item.page, layout.margin, drawY, item.w, item.h);
    }
    context.restore();
    return;
  }

  const left = pdf.x - pdf.width / 2;
  const top = pdf.y - pdf.height / 2;
  context.save();
  context.fillStyle = 'rgba(15, 17, 23, 0.35)';
  context.fillRect(left - 4, top - 4, pdf.width + 8, pdf.height + 8);
  context.strokeStyle = pdf.selected ? '#818cf8' : 'rgba(99, 102, 241, 0.45)';
  context.lineWidth = pdf.selected ? 3 : 2;
  context.strokeRect(left - 2, top - 2, pdf.width + 4, pdf.height + 4);
  if (pdf.selected) {
    context.shadowColor = '#818cf8';
    context.shadowBlur = 12;
  }
  context.drawImage(pdf.pages[pdf.pageIndex], left, top, pdf.width, pdf.height);
  context.restore();
}

function isPinchNearPdf(tip, pdf) {
  if (!pdf || !tip) return false;
  if (pdf.fullscreen) return true;
  const pad = 72;
  const hw = pdf.width / 2 + pad;
  const hh = pdf.height / 2 + pad;
  return tip.x >= pdf.x - hw && tip.x <= pdf.x + hw && tip.y >= pdf.y - hh && tip.y <= pdf.y + hh;
}

function shouldPdfTwoHandZoom(tipA, tipB) {
  const pdf = pdfViewerState.stroke;
  if (!pdf) return false;
  if (pdf.fullscreen) return true;
  return isPinchNearPdf(tipA, pdf) || isPinchNearPdf(tipB, pdf);
}

function findPdfStrokeAt(x, y, radius = PDF_EMBEDDED_HIT_RADIUS) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (!stroke.isPdf) continue;
    if (stroke.fullscreen) {
      const pad = PDF_FULLSCREEN_HIT_PAD;
      const contentRight = mainCanvas.width - PDF_FS_TOOLBAR_W + pad;
      if (x >= -pad && x <= contentRight && y >= -pad && y <= mainCanvas.height + pad) {
        return stroke;
      }
      continue;
    }
    const hw = stroke.width / 2 + radius;
    const hh = stroke.height / 2 + radius;
    if (x >= stroke.x - hw && x <= stroke.x + hw && y >= stroke.y - hh && y <= stroke.y + hh) {
      return stroke;
    }
  }
  return null;
}

function getPdfContextForPoint(x, y) {
  if (pdfViewerState.fullscreen && pdfViewerState.stroke) return pdfViewerState.stroke;
  return findPdfStrokeAt(x, y);
}

function removePdfDocument(pdfId) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.isPdf && stroke.id === pdfId) {
      strokes.splice(i, 1);
    } else if (stroke.pdfId === pdfId) {
      strokes.splice(i, 1);
    }
  }
}

function updatePdfImportUI() {
  const pdf = pdfViewerState.stroke;
  if (!pdf) {
    pdfImportMeta?.classList.add('hidden');
    btnPdfFullscreen?.classList.add('hidden');
    btnPdfExit?.classList.add('hidden');
    return;
  }
  if (pdfImportMeta) {
    const zoomPct = Math.round((pdf.pdfZoom || 1) * 100);
    pdfImportMeta.textContent = `${pdf.fileName} · ${pdf.pageCount} page${pdf.pageCount > 1 ? 's' : ''} · ${zoomPct}%`;
    pdfImportMeta.classList.remove('hidden');
  }
  btnPdfFullscreen?.classList.toggle('hidden', pdf.fullscreen);
  btnPdfExit?.classList.toggle('hidden', !pdf.fullscreen);
}

function collapseCreatorSidebar() {
  const sidebar = document.getElementById('creator-sidebar');
  const app = document.getElementById('app');
  const toggle = document.getElementById('sidebar-toggle');
  sidebar?.classList.add('collapsed');
  app?.classList.add('sidebar-collapsed');
  if (toggle) toggle.textContent = '›';
}

function placePdfOnCanvas(pages, fileName) {
  if (!pages?.length) throw new Error('PDF has no pages');

  if (pdfViewerState.stroke?.id) {
    removePdfDocument(pdfViewerState.stroke.id);
  }

  const firstPage = pages[0];
  const maxW = Math.min(mainCanvas.width * 0.38, 420);
  const scale = maxW / firstPage.width;
  const width = firstPage.width * scale;
  const height = firstPage.height * scale;

  const stroke = {
    id: `pdf-${Date.now()}`,
    isPdf: true,
    isDocument: true,
    fileName,
    pages,
    pageCount: pages.length,
    pageIndex: 0,
    scrollY: 0,
    pdfZoom: PDF_DEFAULT_ZOOM,
    fullscreen: false,
    x: mainCanvas.width * 0.2,
    y: mainCanvas.height * 0.44,
    width: width * PDF_DEFAULT_ZOOM,
    height: height * PDF_DEFAULT_ZOOM,
    baseWidth: width,
    baseHeight: height,
    image: firstPage,
    selected: false,
    _layoutCache: null,
  };

  strokes.unshift(stroke);
  pdfViewerState.stroke = stroke;
  pdfViewerState.fullscreen = false;
  updatePdfImportUI();
  collapseCreatorSidebar();
  redraw();
  gestureLabel.textContent = 'PDF on left · two-hand pinch on PDF to zoom';
}

function syncStrokeUi(width) {
  activeWidth = width;
  const label = `${width}px`;
  if (strokeSizeInput) strokeSizeInput.value = String(width);
  if (strokeLabel) strokeLabel.textContent = label;
  if (fsStrokeSizeInput) fsStrokeSizeInput.value = String(width);
  if (fsStrokeLabel) fsStrokeLabel.textContent = label;
}

function syncColorUi(color) {
  activeColor = color;
  swatches.forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
  fsSwatches.forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
}

function syncCameraFeedPip() {
  const webcam = document.getElementById('webcam');
  if (!pipWebcam || !webcam?.srcObject) return;
  if (pipWebcam.srcObject !== webcam.srcObject) {
    pipWebcam.srcObject = webcam.srcObject;
  }
  pipWebcam.play().catch(() => {});
}

function showPdfFullscreenUi() {
  pdfFullscreenUi?.classList.remove('hidden');
  pdfFullscreenUi?.setAttribute('aria-hidden', 'false');
  syncStrokeUi(activeWidth);
  syncColorUi(activeColor);
  syncCameraFeedPip();
}

function hidePdfFullscreenUi() {
  pdfFullscreenUi?.classList.add('hidden');
  pdfFullscreenUi?.setAttribute('aria-hidden', 'true');
  if (pipWebcam) pipWebcam.srcObject = null;
}

function enterPdfFullscreen(pdfStroke) {
  if (!pdfStroke?.isPdf) return;
  pdfStroke.fullscreen = true;
  pdfStroke.scrollY = 0;
  pdfStroke._layoutCache = null;
  pdfStroke.selected = false;
  pdfViewerState.stroke = pdfStroke;
  pdfViewerState.fullscreen = true;
  document.getElementById('app')?.classList.add('pdf-fullscreen');
  showPdfFullscreenUi();
  stopPdfScrollMomentum();
  endPinchDrag();
  resetPdfGestures();
  updatePdfImportUI();
  redraw();
  gestureLabel.textContent = 'PDF fullscreen · pinch scroll · two-hand zoom';
}

function exitPdfFullscreen() {
  const pdf = pdfViewerState.stroke;
  if (pdf) {
    pdf.fullscreen = false;
    pdf.scrollY = 0;
    pdf._layoutCache = null;
    pdf.width = pdf.baseWidth * pdf.pdfZoom;
    pdf.height = pdf.baseHeight * pdf.pdfZoom;
  }
  pdfViewerState.fullscreen = false;
  document.getElementById('app')?.classList.remove('pdf-fullscreen');
  hidePdfFullscreenUi();
  stopPdfScrollMomentum();
  resetPdfGestures();
  endPinchDrag();
  updatePdfImportUI();
  redraw();
  gestureLabel.textContent = 'PDF embedded · pinch to move';
}

function resetPdfScrollGesture() {
  lastPdfScrollMidY = null;
}

function resetPdfZoomGesture() {
  lastPdfPinchDistance = null;
  smoothedPdfPinchDistance = null;
}

function resetPdfGestures() {
  resetPdfScrollGesture();
  resetPdfZoomGesture();
}

function updatePdfScrollTwoHand(tipA, tipB, pdf) {
  const cy = (tipA.y + tipB.y) / 2;
  if (lastPdfScrollMidY !== null) {
    scrollPdf(pdf, -(cy - lastPdfScrollMidY) * PDF_SCROLL_SENSITIVITY);
  }
  lastPdfScrollMidY = cy;
}

function applyPdfZoom(pdf, ratio) {
  const clamped = Math.max(0.94, Math.min(1.06, ratio));
  pdf.pdfZoom = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, pdf.pdfZoom * clamped));
  pdf._layoutCache = null;
  if (!pdf.fullscreen) {
    pdf.width = pdf.baseWidth * pdf.pdfZoom;
    pdf.height = pdf.baseHeight * pdf.pdfZoom;
  }
  const maxScroll = getPdfMaxScroll(pdf);
  pdf.scrollY = Math.min(pdf.scrollY, maxScroll);
  updatePdfImportUI();
  redraw();
}

function updatePdfZoomTwoHand(tipA, tipB, pdf) {
  const rawDistance = dist(tipA.x, tipA.y, tipB.x, tipB.y);
  if (rawDistance < 12) return;

  if (smoothedPdfPinchDistance === null) {
    smoothedPdfPinchDistance = rawDistance;
  } else {
    smoothedPdfPinchDistance =
      PDF_ZOOM_SMOOTH * rawDistance + (1 - PDF_ZOOM_SMOOTH) * smoothedPdfPinchDistance;
  }

  if (lastPdfPinchDistance !== null && lastPdfPinchDistance > 12) {
    applyPdfZoom(pdf, smoothedPdfPinchDistance / lastPdfPinchDistance);
  }
  lastPdfPinchDistance = smoothedPdfPinchDistance;
}

function translatePdfOverlays(pdfStroke, dx, dy) {
  if (!pdfStroke?.id) return;
  for (const stroke of strokes) {
    if (stroke.pdfId !== pdfStroke.id || !stroke.points) continue;
    for (const point of stroke.points) {
      point[0] += dx;
      point[1] += dy;
    }
    if (stroke.renderer) refreshStrokeRenderer(stroke);
  }
}

function redraw() {
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  if (!mirrorEnabled) {
    ctx.fillStyle = '#16181f';
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
  }

  const fullscreenPdf =
    pdfViewerState.fullscreen && pdfViewerState.stroke?.fullscreen
      ? pdfViewerState.stroke
      : null;

  if (fullscreenPdf) {
    drawPdfStroke(ctx, fullscreenPdf);
    for (const stroke of strokes) {
      if (stroke.isPdf) continue;
      if (stroke.pdfId !== fullscreenPdf.id) continue;
      ctx.save();
      if (stroke.selected) {
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 12;
      }
      drawStrokeItem(ctx, stroke);
      ctx.restore();
    }
    if (currentStroke?.pdfId === fullscreenPdf.id) {
      drawFreehandPath(ctx, currentStroke.points, currentStroke.color, currentStroke.width);
    }
    for (const state of handStates) {
      if (state.currentStroke?.pdfId === fullscreenPdf.id) {
        drawFreehandPath(
          ctx,
          state.currentStroke.points,
          state.currentStroke.color,
          state.currentStroke.width,
        );
      }
    }
    return;
  }

  for (const stroke of strokes) {
    if (stroke.isPdf) {
      drawPdfStroke(ctx, stroke);
      continue;
    }

    if (stroke.image) {
      ctx.save();
      const w = stroke.width;
      const h = stroke.height;
      const left = stroke.x - w / 2;
      const top = stroke.y - h / 2;

      if (stroke.isDocument) {
        ctx.fillStyle = 'rgba(15, 17, 23, 0.35)';
        ctx.fillRect(left - 4, top - 4, w + 8, h + 8);
        ctx.strokeStyle = stroke.selected ? '#818cf8' : 'rgba(99, 102, 241, 0.45)';
        ctx.lineWidth = stroke.selected ? 3 : 2;
        ctx.strokeRect(left - 2, top - 2, w + 4, h + 4);
      }

      if (stroke.selected) {
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 12;
      }
      ctx.drawImage(stroke.image, left, top, w, h);
      ctx.restore();
      continue;
    }

    if (stroke.text) {
      ctx.font = 'bold 32px sans-serif';
      ctx.fillStyle = stroke.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stroke.text, stroke.x, stroke.y);
      continue;
    }

    ctx.save();
    if (stroke.selected) {
      ctx.shadowColor = '#818cf8';
      ctx.shadowBlur = 12;
    }

    if (stroke.renderer) {
      stroke.renderer(ctx, stroke.color, stroke.width);
    } else {
      drawFreehandPath(ctx, stroke.points, stroke.color, stroke.width);
    }
    ctx.restore();
  }

  if (currentStroke) {
    drawFreehandPath(ctx, currentStroke.points, currentStroke.color, currentStroke.width);
  }

  for (const state of handStates) {
    if (state.currentStroke) {
      drawFreehandPath(
        ctx,
        state.currentStroke.points,
        state.currentStroke.color,
        state.currentStroke.width,
      );
    }
  }
}

function finishHandStroke(handIndex) {
  const state = handStates[handIndex];
  if (!state.currentStroke || state.currentStroke.points.length < 1) {
    state.currentStroke = null;
    state.isDrawing = false;
    state.lastDrawPoint = null;
    return;
  }
  strokes.push(state.currentStroke);
  state.currentStroke = null;
  state.isDrawing = false;
  state.lastDrawPoint = null;
  redraw();
}

function startHandStroke(handIndex, x, y) {
  const pdf = getPdfContextForPoint(x, y);
  handStates[handIndex].currentStroke = {
    points: [[x, y]],
    color: activeColor,
    width: activeWidth,
    renderer: null,
    pdfId: pdf?.id || null,
  };
  handStates[handIndex].lastDrawPoint = { x, y };
}

function extendHandStroke(handIndex, x, y) {
  const state = handStates[handIndex];
  if (!state.currentStroke) return;
  const pts = state.currentStroke.points;
  const last = pts[pts.length - 1];
  if (last[0] === x && last[1] === y) return;
  pts.push([x, y]);
  state.lastDrawPoint = { x, y };
  redraw();
}

function finishCurrentStroke() {
  if (!currentStroke || currentStroke.points.length < 1) {
    currentStroke = null;
    return;
  }
  strokes.push(currentStroke);
  currentStroke = null;
  redraw();
}

function startStroke(x, y, color, width) {
  const pdf = getPdfContextForPoint(x, y);
  currentStroke = {
    points: [[x, y]],
    color,
    width,
    renderer: null,
    pdfId: pdf?.id || null,
  };
}

function extendStroke(x, y) {
  if (!currentStroke) return;
  const pts = currentStroke.points;
  const last = pts[pts.length - 1];
  if (last[0] === x && last[1] === y) return;
  pts.push([x, y]);
  redraw();
}

function eraseStrokesAt(x, y, radius = 20) {
  const before = strokes.length;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.isPdf) continue;
    const hit = stroke.image
      ? x >= stroke.x - stroke.width / 2 - radius &&
        x <= stroke.x + stroke.width / 2 + radius &&
        y >= stroke.y - stroke.height / 2 - radius &&
        y <= stroke.y + stroke.height / 2 + radius
      : stroke.text
      ? dist(stroke.x, stroke.y, x, y) < radius + 40
      : stroke.points?.some(([px, py]) => dist(px, py, x, y) < radius);

    if (hit) {
      strokes.splice(i, 1);
    }
  }
  if (strokes.length !== before) redraw();
}

function flashCanvas() {
  mainCanvas.style.filter = 'brightness(1.75)';
  setTimeout(() => {
    mainCanvas.style.filter = '';
  }, 250);
}

// ─── Shape snap ─────────────────────────────────────────────────────────────────

function snapLastStroke(forceType = null) {
  if (strokes.length === 0) return false;
  const stroke = strokes[strokes.length - 1];
  if (stroke.text || !stroke.points || stroke.points.length < 2) return false;

  const result = classifyStroke(stroke.points);
  if (forceType) {
    result.type = forceType;
  } else if (result.type === ShapeType.UNKNOWN) {
    gestureLabel.textContent = 'No shape detected';
    return false;
  }

  const renderer = getCanonicalRenderer(result, stroke.points);
  if (!renderer) return false;

  stroke.renderer = renderer;
  stroke.shapeType = result.type;
  redraw();
  flashCanvas();
  gestureLabel.textContent = `Snapped: ${result.type}`;
  return true;
}

function applyAutoSnap() {
  if (!snapLastStroke()) {
    gestureLabel.textContent = 'Could not auto-snap last stroke';
  }
}

function resetHandHoldSnap(state) {
  state.holdSnapPoint = null;
}

function processHandInteraction(landmarks, handIndex, handInfo, now) {
  const state = handStates[handIndex];
  const { gesture, drawPoint } = handInfo;

  if (!state.armed) {
    state.prevGesture = gesture;
    return gesture;
  }

  if (gesture === Gesture.ERASE && drawPoint) {
    if (state.isDrawing) finishHandStroke(handIndex);
    eraseStrokesAt(drawPoint.x, drawPoint.y, 20);
    resetHandHoldSnap(state);
    state.prevGesture = gesture;
    return gesture;
  }

  if (gesture === Gesture.DRAW && drawPoint) {
    state.drawExitFrames = 0;
    state.unstableFrames = 0;
    const moved = state.holdSnapPoint
      ? dist(state.holdSnapPoint.x, state.holdSnapPoint.y, drawPoint.x, drawPoint.y) > HOLD_MOVE_THRESHOLD
      : true;

    if (moved) {
      if (!state.isDrawing) {
        startHandStroke(handIndex, drawPoint.x, drawPoint.y);
        state.isDrawing = true;
      } else {
        extendHandStroke(handIndex, drawPoint.x, drawPoint.y);
      }
      resetHandHoldSnap(state);
      state.holdSnapPoint = { x: drawPoint.x, y: drawPoint.y };
    } else {
      state.holdSnapPoint = { x: drawPoint.x, y: drawPoint.y };
      resetHandHoldSnap(state);
    }

    state.prevGesture = gesture;
    return gesture;
  }

  if (gesture === Gesture.DRAW && state.isDrawing) {
    state.drawExitFrames = 0;
    if (state.unstableFrames >= UNSTABLE_FINISH_FRAMES) {
      finishHandStroke(handIndex);
      state.unstableFrames = 0;
    }
    state.prevGesture = gesture;
    return gesture;
  }

  if (state.isDrawing) {
    state.drawExitFrames++;
    if (state.drawExitFrames < DRAW_EXIT_FRAMES) {
      state.prevGesture = gesture;
      return gesture;
    }
    finishHandStroke(handIndex);
    state.drawExitFrames = 0;
  }

  resetHandHoldSnap(state);
  state.prevGesture = gesture;
  return gesture;
}

function resetHandStateSlot(slotIndex) {
  const state = handStates[slotIndex];
  if (state.isDrawing) finishHandStroke(slotIndex);
  state.gestureSmoother = new GestureSmoother(5);
  state.pointSmoother.reset();
  state.currentStroke = null;
  state.isDrawing = false;
  state.prevGesture = Gesture.UNKNOWN;
  state.stableFrameCount = 0;
  state.armed = false;
  state.lostFrames = 0;
  state.drawExitFrames = 0;
  state.unstableFrames = 0;
  state.lastDrawPoint = null;
  state.lastDrawTime = 0;
  state.lastWrist = null;
  state.lastHandScale = null;
  resetHandHoldSnap(state);
  state.openPalmHoldStart = null;
  slotWristMemory[slotIndex] = null;
}

function resetAllHandStates() {
  endPinchDrag();
  for (let i = 0; i < handStates.length; i++) {
    resetHandStateSlot(i);
  }
}

function updateHandSlotTracking(handData) {
  const activeSlots = new Set(handData.map((h) => h.handIndex));
  for (let i = 0; i < handStates.length; i++) {
    const state = handStates[i];
    if (activeSlots.has(i)) {
      state.lostFrames = 0;
      state.stableFrameCount = Math.min(state.stableFrameCount + 1, 30);
      state.armed = state.stableFrameCount >= HAND_WARMUP_FRAMES;
    } else if (state.isDrawing && state.lostFrames < HAND_LOST_GRACE_FRAMES) {
      state.lostFrames++;
    } else if (state.stableFrameCount > 0 || state.armed || state.isDrawing) {
      resetHandStateSlot(i);
    }
  }
}

function resetHoldSnap() {
  for (const state of handStates) resetHandHoldSnap(state);
}

// ─── Object pick / move (single-hand pinch) ─────────────────────────────────────

function findStrokeAt(x, y, radius = 36) {
  const pdfHit = findPdfStrokeAt(x, y);
  if (pdfHit) return pdfHit;

  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (stroke.isPdf) continue;
    if (stroke.image) {
      const hw = stroke.width / 2 + radius;
      const hh = stroke.height / 2 + radius;
      if (x >= stroke.x - hw && x <= stroke.x + hw && y >= stroke.y - hh && y <= stroke.y + hh) {
        return stroke;
      }
      continue;
    }
    if (stroke.text) {
      if (dist(stroke.x, stroke.y, x, y) < radius + 30) return stroke;
      continue;
    }
    if (!stroke.points?.length) continue;
    if (stroke.points.some(([px, py]) => dist(px, py, x, y) < radius)) return stroke;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of stroke.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    if (x >= minX - radius && x <= maxX + radius && y >= minY - radius && y <= maxY + radius) {
      return stroke;
    }
  }
  return null;
}

function refreshStrokeRenderer(stroke) {
  if (!stroke.shapeType || !stroke.points?.length) return;
  const analyzed = classifyStroke(stroke.points);
  stroke.renderer = getCanonicalRenderer(
    { ...analyzed, type: stroke.shapeType },
    stroke.points,
  );
}

function translateStroke(stroke, dx, dy) {
  if (!stroke || (dx === 0 && dy === 0)) return;

  if (stroke.image || stroke.text) {
    stroke.x += dx;
    stroke.y += dy;
    if (stroke.isPdf) translatePdfOverlays(stroke, dx, dy);
    redraw();
    return;
  }

  if (!stroke.points) return;
  for (const p of stroke.points) {
    p[0] += dx;
    p[1] += dy;
  }
  refreshStrokeRenderer(stroke);
  redraw();
}

function endPinchDrag() {
  const stroke = dragState.stroke;
  const scrollVel = dragState.scrollVelocity;

  if (stroke) stroke.selected = false;

  if (stroke?.isPdf && stroke.fullscreen && Math.abs(scrollVel) >= PDF_SCROLL_MOMENTUM_MIN) {
    startPdfScrollMomentum(stroke, scrollVel);
  }

  dragState.active = false;
  dragState.stroke = null;
  dragState.handIndex = -1;
  dragState.scrollVelocity = 0;
  dragState.lastScrollTime = 0;
}

function processPinchDrag(handIndex, drawPoint) {
  if (!drawPoint) return;

  if (!dragState.active || dragState.handIndex !== handIndex) {
    const stroke = findStrokeAt(drawPoint.x, drawPoint.y);
    if (!stroke) {
      gestureLabel.textContent = 'Pinch: no object here';
      return;
    }
    stopPdfScrollMomentum();
    endPinchDrag();
    dragState.active = true;
    dragState.stroke = stroke;
    dragState.lastX = drawPoint.x;
    dragState.lastY = drawPoint.y;
    dragState.handIndex = handIndex;
    dragState.scrollVelocity = 0;
    dragState.lastScrollTime = performance.now();
    stroke.selected = true;
    gestureLabel.textContent = stroke.isPdf && stroke.fullscreen
      ? 'PDF pinch · drag up to scroll'
      : 'Pinch: holding object';
    redraw();
    return;
  }

  const dx = drawPoint.x - dragState.lastX;
  const dy = drawPoint.y - dragState.lastY;
  const stroke = dragState.stroke;
  const now = performance.now();

  if (stroke.isPdf && stroke.fullscreen) {
    if (Math.abs(dy) > 0.05) {
      const delta = -dy * PDF_SCROLL_SENSITIVITY;
      scrollPdf(stroke, delta);
      const dt = Math.max(8, now - (dragState.lastScrollTime || now));
      const instantVel = (delta / dt) * 16.67;
      dragState.scrollVelocity = dragState.scrollVelocity * 0.35 + instantVel * 0.65;
      dragState.lastScrollTime = now;
      dragState.lastX = drawPoint.x;
      dragState.lastY = drawPoint.y;
      gestureLabel.textContent = `PDF scroll · ${Math.round(stroke.scrollY)}px`;
    }
    return;
  }

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    if (stroke.isPdf) {
      translateStroke(stroke, dx, dy);
      dragState.lastX = drawPoint.x;
      dragState.lastY = drawPoint.y;
      gestureLabel.textContent = `PDF move · zoom ${Math.round(stroke.pdfZoom * 100)}%`;
    } else {
      translateStroke(stroke, dx, dy);
      dragState.lastX = drawPoint.x;
      dragState.lastY = drawPoint.y;
      gestureLabel.textContent = 'Pinch: moving';
    }
  }
}

// ─── View transform (two-hand pinch: zoom + rotate) ─────────────────────────────

function applyViewTransform() {
  const deg = (zoomRotation * 180) / Math.PI;
  const t = `translate(${zoomTx}px, ${zoomTy}px) rotate(${deg}deg) scale(${zoomScale})`;
  mainCanvas.style.transformOrigin = '0 0';
  mainCanvas.style.transform = t;
  handCanvas.style.transformOrigin = '0 0';
  handCanvas.style.transform = t;
  modeIndicator.textContent = `${Math.round(zoomScale * 100)}% · ${Math.round(deg)}°`;
}

function resetPinchZoomState() {
  lastPinchDistance = null;
  lastPinchAngle = null;
  smoothedPinchDistance = null;
  smoothedPinchAngle = null;
  isPinchZooming = false;
  stableTwoHandFrames = 0;
  lostHandFrames = 0;
}

function resetZoom() {
  zoomScale = 1;
  zoomTx = 0;
  zoomTy = 0;
  zoomRotation = 0;
  resetPinchZoomState();
  applyViewTransform();
}

function beginPinchZoom() {
  if (isPinchZooming) return;
  isPinchZooming = true;
  lastPinchDistance = null;
  lastPinchAngle = null;
  smoothedPinchDistance = null;
  smoothedPinchAngle = null;
  endPinchDrag();
  for (let i = 0; i < handStates.length; i++) {
    if (handStates[i].isDrawing) finishHandStroke(i);
  }
}

function endPinchZoom() {
  resetPinchZoomState();
}

function updateTwoHandPinch(tipA, tipB) {
  const cx = (tipA.x + tipB.x) / 2;
  const cy = (tipA.y + tipB.y) / 2;
  const rawDistance = dist(tipA.x, tipA.y, tipB.x, tipB.y);
  const rawAngle = Math.atan2(tipB.y - tipA.y, tipB.x - tipA.x);

  if (smoothedPinchDistance === null) {
    smoothedPinchDistance = rawDistance;
  } else {
    smoothedPinchDistance =
      PINCH_SMOOTH_ALPHA * rawDistance +
      (1 - PINCH_SMOOTH_ALPHA) * smoothedPinchDistance;
  }

  if (smoothedPinchAngle === null) {
    smoothedPinchAngle = rawAngle;
  } else {
    let delta = rawAngle - smoothedPinchAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    smoothedPinchAngle += PINCH_SMOOTH_ALPHA * delta;
  }

  const distance = smoothedPinchDistance;
  const angle = smoothedPinchAngle;

  if (lastPinchDistance !== null && lastPinchAngle !== null && lastPinchDistance > 0) {
    const distDelta = distance - lastPinchDistance;
    let angleDelta = angle - lastPinchAngle;
    while (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
    while (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

    if (Math.abs(distDelta) >= TWO_HAND_PINCH_MOVE_THRESHOLD) {
      let ratio = distance / lastPinchDistance;
      ratio = Math.max(1 - MAX_ZOOM_RATIO_DELTA, Math.min(1 + MAX_ZOOM_RATIO_DELTA, ratio));
      const newScale = Math.min(4, Math.max(0.25, zoomScale * ratio));
      const scaleChange = newScale / zoomScale;

      const dx = zoomTx - cx;
      const dy = zoomTy - cy;
      zoomTx = cx + dx * scaleChange;
      zoomTy = cy + dy * scaleChange;
      zoomScale = newScale;
    }

    if (Math.abs(angleDelta) >= 0.02) {
      const clampedRot = Math.max(-MAX_ROT_DELTA, Math.min(MAX_ROT_DELTA, angleDelta));
      const cos = Math.cos(clampedRot);
      const sin = Math.sin(clampedRot);
      const dx = zoomTx - cx;
      const dy = zoomTy - cy;
      zoomTx = cx + dx * cos - dy * sin;
      zoomTy = cy + dx * sin + dy * cos;
      zoomRotation += clampedRot;
    }

    applyViewTransform();
  }

  lastPinchDistance = distance;
  lastPinchAngle = angle;
  return { distance, angle };
}

// Legacy alias
function applyZoomTransform() {
  applyViewTransform();
}

// ─── Mouse / touch drawing ──────────────────────────────────────────────────────

function onPointerDown(e) {
  if (activeMode === 'select') return;
  const [x, y] = clientToCanvas(e.clientX, e.clientY);
  isPointerDown = true;

  if (activeMode === 'erase') {
    eraseStrokesAt(x, y);
    return;
  }

  startStroke(x, y, activeColor, activeWidth);
  redraw();
}

function onPointerMove(e) {
  if (!isPointerDown) return;
  const [x, y] = clientToCanvas(e.clientX, e.clientY);

  if (activeMode === 'erase') {
    eraseStrokesAt(x, y);
    return;
  }

  extendStroke(x, y);
}

function onPointerUp() {
  if (!isPointerDown) return;
  isPointerDown = false;

  if (activeMode === 'draw') {
    finishCurrentStroke();
  }
}

function bindPointerEvents() {
  mainCanvas.addEventListener('mousedown', onPointerDown);
  mainCanvas.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  mainCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onPointerDown({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  mainCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    onPointerMove({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  mainCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    onPointerUp();
  });
}

// ─── Toolbar wiring ─────────────────────────────────────────────────────────────

function setActiveTool(mode) {
  activeMode = mode;
  toolButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  applyViewTransform();
}

function setActiveColor(color) {
  syncColorUi(color);
}

function wireStrokeControls(input, onInput) {
  input?.addEventListener('input', () => {
    syncStrokeUi(Number(input.value));
    onInput?.();
  });
}

function wireToolbar() {
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.mode));
  });

  swatches.forEach((sw) => {
    sw.addEventListener('click', () => setActiveColor(sw.dataset.color));
  });

  fsSwatches.forEach((sw) => {
    sw.addEventListener('click', () => setActiveColor(sw.dataset.color));
  });

  wireStrokeControls(strokeSizeInput);
  wireStrokeControls(fsStrokeSizeInput);
  syncStrokeUi(Number(strokeSizeInput?.value || 12));

  btnSnapCircle.addEventListener('click', () => snapLastStroke(ShapeType.CIRCLE));
  btnSnapRect.addEventListener('click', () => snapLastStroke(ShapeType.RECTANGLE));
  btnSnapLine.addEventListener('click', () => snapLastStroke(ShapeType.LINE));
  btnAutoSnap.addEventListener('click', applyAutoSnap);

  btnCameraToggle?.addEventListener('click', () => toggleCameraMirror());

  btnClear.addEventListener('click', () => {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (!strokes[i].isPdf) strokes.splice(i, 1);
    }
    currentStroke = null;
    redraw();
  });

  btnExport.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'gesture-canvas.png';
    link.href = mainCanvas.toDataURL('image/png');
    link.click();
  });

  btnRecognize.addEventListener('click', runOcr);
}

async function handlePdfImport(file) {
  gestureLabel.textContent = 'Loading PDF…';
  if (pdfImportMeta) {
    pdfImportMeta.textContent = `Loading ${file.name}…`;
    pdfImportMeta.classList.remove('hidden');
  }
  const doc = await loadPdfFile(file);
  const pages = await renderAllPdfPages(doc);
  if (!pages.length) throw new Error('PDF has no pages');
  placePdfOnCanvas(pages, doc.fileName);
}

function wirePdfImport() {
  pdfFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await handlePdfImport(file);
    } catch (err) {
      console.error('PDF import error:', err);
      gestureLabel.textContent = `PDF import failed: ${err.message}`;
      if (pdfImportMeta) {
        pdfImportMeta.textContent = `Import failed: ${err.message}`;
        pdfImportMeta.classList.remove('hidden');
      }
    } finally {
      e.target.value = '';
    }
  });

  btnPdfFullscreen?.addEventListener('click', () => {
    if (!pdfViewerState.stroke) {
      gestureLabel.textContent = 'Import a PDF first';
      return;
    }
    enterPdfFullscreen(pdfViewerState.stroke);
  });

  btnPdfExit?.addEventListener('click', () => exitPdfFullscreen());
  btnPdfFsClose?.addEventListener('click', () => exitPdfFullscreen());
}

// ─── OCR ────────────────────────────────────────────────────────────────────────

function getDrawableStrokesBounds(strokeList) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  strokeList.forEach((stroke, index) => {
    if (stroke.text) return;
    if (!stroke.points || stroke.points.length === 0) return;
    found = true;
    for (const [x, y] of stroke.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  });

  if (!found) return null;
  const pad = 20;
  return {
    minX: Math.max(0, minX - pad),
    minY: Math.max(0, minY - pad),
    maxX: Math.min(mainCanvas.width, maxX + pad),
    maxY: Math.min(mainCanvas.height, maxY + pad),
    indices: strokeList
      .map((s, i) => (!s.text && s.points?.length ? i : -1))
      .filter((i) => i >= 0),
  };
}

async function runOcr() {
  const bounds = getDrawableStrokesBounds(strokes);
  if (!bounds) return;

  lastOcrStrokeIndices = bounds.indices;
  lastOcrBounds = bounds;

  ocrOverlay.classList.remove('hidden');
  ocrResult.textContent = '';
  const spinner = ocrOverlay.querySelector('.spinner, .ocr-spinner, [class*="spinner"]');
  spinner?.classList.remove('hidden');

  const w = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const h = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));

  const crop = document.createElement('canvas');
  crop.width = w;
  crop.height = h;
  const cropCtx = crop.getContext('2d');
  cropCtx.fillStyle = '#111827';
  cropCtx.fillRect(0, 0, w, h);
  cropCtx.drawImage(
    mainCanvas,
    bounds.minX,
    bounds.minY,
    w,
    h,
    0,
    0,
    w,
    h,
  );

  try {
    const { data } = await Tesseract.recognize(crop, 'eng');
    ocrResult.textContent = data.text.trim() || '(no text detected)';
  } catch (err) {
    console.error(err);
    ocrResult.textContent = 'OCR failed';
  } finally {
    spinner?.classList.add('hidden');
  }
}

function replaceOcrOnCanvas() {
  const text = ocrResult.textContent.trim();
  if (!text || text === 'OCR failed') return;
  if (!lastOcrBounds) return;

  const cx = (lastOcrBounds.minX + lastOcrBounds.maxX) / 2;
  const cy = (lastOcrBounds.minY + lastOcrBounds.maxY) / 2;

  for (let i = lastOcrStrokeIndices.length - 1; i >= 0; i--) {
    strokes.splice(lastOcrStrokeIndices[i], 1);
  }

  strokes.push({
    text,
    x: cx,
    y: cy,
    color: activeColor,
    points: [],
    width: 0,
    renderer: null,
  });

  lastOcrStrokeIndices = [];
  lastOcrBounds = null;
  redraw();
  ocrOverlay.classList.add('hidden');
}

function wireOcr() {
  ocrClose.addEventListener('click', () => {
    ocrOverlay.classList.add('hidden');
  });

  if (ocrReplace) {
    ocrReplace.addEventListener('click', replaceOcrOnCanvas);
  } else {
    const replaceBtn = [...ocrOverlay.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Replace'),
    );
    replaceBtn?.addEventListener('click', replaceOcrOnCanvas);
  }
}

// ─── Hand tracking (MediaPipe Hands) ───────────────────────────────────────────

let hands = null;
let fpsFrames = 0;
let fpsLastTime = performance.now();

async function initHandTracking() {
  // MediaPipe is loaded via <script> tags in index.html (globals on window).
  // ES modules cannot see those globals unless accessed through window.
  const video = document.getElementById('webcam');
  const HandsCtor = window.Hands;
  const CameraCtor = window.Camera;
  const drawConnectors = window.drawConnectors;
  const drawLandmarks = window.drawLandmarks;
  const connections = window.HAND_CONNECTIONS;

  if (!video) {
    console.warn('Missing #webcam element');
    return;
  }

  if (!HandsCtor || !CameraCtor || !drawConnectors || !drawLandmarks || !connections) {
    console.warn('MediaPipe scripts failed to load');
    gestureLabel.textContent = 'MediaPipe failed to load';
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    gestureLabel.textContent = 'Camera requires HTTPS or localhost';
    return;
  }

  video.muted = true;
  video.playsInline = true;

  try {
    hands = new HandsCtor({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });

    hands.onResults((results) =>
      onHandResults(results, drawConnectors, drawLandmarks, connections),
    );

    if (typeof hands.initialize === 'function') {
      await hands.initialize();
    }

    const camSize = getCameraFrameSize();

    const camera = new CameraCtor(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: camSize.width,
      height: camSize.height,
    });

    await camera.start();
    syncCameraFeedPip();
    toggleCameraMirror(true);
    gestureLabel.textContent = 'Show your hand to start';
  } catch (err) {
    console.warn('MediaPipe / camera unavailable — mouse drawing still works.', err);
    gestureLabel.textContent = `Camera unavailable: ${err.message}`;
  }
}

function onHandResults(results, drawConnectors, drawLandmarks, connections) {
  const now = performance.now();
  fpsFrames += 1;
  if (now - fpsLastTime >= 1000) {
    fpsCounter.textContent = `${fpsFrames} FPS`;
    fpsFrames = 0;
    fpsLastTime = now;
  }

  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  const handEntries = dedupeHandLandmarks(
    results.multiHandLandmarks,
    results.multiHandedness,
  );
  let validHands = filterValidHands(handEntries, results.multiHandedness);

  const twoPinchHands = retainTwoPinchingHands(handEntries, results.multiHandedness);
  if (twoPinchHands) {
    validHands = twoPinchHands;
  }

  // Edge fallback: MediaPipe often sees the hand but fingertips clip past [0,1]
  if (validHands.length === 0 && handEntries.length > 0) {
    let best = null;
    let bestScore = -1;
    for (const entry of handEntries) {
      const score = getHandConfidence(results.multiHandedness, entry.sourceIndex);
      const wrist = entry.landmarks[0];
      if (!isWristOnScreen(wrist)) continue;
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    if (best && bestScore >= 0.28) {
      validHands = [best];
    }
  }

  if (validHands.length === 0) {
    noHandFrames++;
    const drawing = handStates.some((s) => s.isDrawing);
    const grace = drawing ? NO_HAND_RESET_FRAMES + 6 : NO_HAND_RESET_FRAMES;
    if (noHandFrames < grace) {
      updateMirrorGestureToggle([], now);
      gestureLabel.textContent = drawing
        ? 'Hand lost briefly — keep drawing pose'
        : noHandFrames > 3
          ? 'Hand lost…'
          : 'No hand';
      return;
    }
    noHandFrames = 0;
    resetAllHandStates();
    endPinchDrag();
    updateMirrorGestureToggle([], now);
    if (isPinchZooming) endPinchZoom();
    gestureLabel.textContent = 'No hand';
    return;
  }

  noHandFrames = 0;

  validHands = preferSingleHandWhileDrawing(validHands);
  const slottedHands = assignHandSlots(validHands);

  const handData = slottedHands.map(({ landmarks, sourceIndex, slotIndex }) => {
    const score = getHandConfidence(results.multiHandedness, sourceIndex);
    return {
      landmarks,
      handIndex: slotIndex,
      label: getHandLabel(results, sourceIndex),
      ...classifyHand(landmarks, handStates[slotIndex], score),
    };
  });

  updateSlotWristMemory(handData);
  updateHandSlotTracking(handData);

  const multi = handData.map((h) => h.landmarks);

  updateMirrorGestureToggle(handData, now);

  const bothHandsPinching =
    handData.length >= 2 && handData.every((h) => isPinchPose(h.landmarks));
  if (!bothHandsPinching) {
    handlePauseGestures(handData, now);
  }

  const twoHandTransform = shouldTwoHandTransform(multi, handData);
  const pinchCount = handData.filter((h) => isHandPinching(h)).length;

  // PDF: two-hand pinch zooms the document (fullscreen or when pinching near PDF)
  if (pdfViewerState.stroke && twoHandTransform) {
    const tipA = getPinchCanvasPoint(multi[0]);
    const tipB = getPinchCanvasPoint(multi[1]);
    if (shouldPdfTwoHandZoom(tipA, tipB)) {
      updatePdfZoomTwoHand(tipA, tipB, pdfViewerState.stroke);
      drawFingerPointers(handData);
      drawPipSkeleton(multi[0], connections, drawConnectors, drawLandmarks);
      const pdf = pdfViewerState.stroke;
      gestureLabel.textContent = `PDF zoom · ${Math.round(pdf.pdfZoom * 100)}%`;
      return;
    }
  }

  // Both hands pinching → zoom + rotate using pinch midpoints
  if (twoHandTransform) {
    lostHandFrames = 0;
    stableTwoHandFrames++;

    if (stableTwoHandFrames >= TWO_HAND_STABLE_FRAMES || isPinchZooming) {
      beginPinchZoom();
      const tipA = getPinchCanvasPoint(multi[0]);
      const tipB = getPinchCanvasPoint(multi[1]);
      updateTwoHandPinch(tipA, tipB);
      drawFingerPointers(handData);
      drawPipSkeleton(multi[0], connections, drawConnectors, drawLandmarks);
      const deg = Math.round((zoomRotation * 180) / Math.PI);
      gestureLabel.textContent = `Two-hand pinch · ${Math.round(zoomScale * 100)}% · ${deg}°`;
      return;
    }

    drawFingerPointers(handData);
    if (pinchCount === 1 && handData.length >= 2) {
      gestureLabel.textContent = 'Pinch both hands to zoom… (one hand ready)';
    } else if (handData.length < 2 && results.multiHandLandmarks?.length >= 2) {
      gestureLabel.textContent = 'Pinch both hands to zoom… (tracking 2nd hand)';
    } else {
      gestureLabel.textContent = 'Pinch both hands to zoom…';
    }
    return;
  }

  stableTwoHandFrames = 0;
  resetPdfGestures();

  if (isPinchZooming) {
    lostHandFrames++;
    if (lostHandFrames < ONE_HAND_EXIT_FRAMES) {
      drawFingerPointers(handData);
      gestureLabel.textContent = 'Two-hand pinch';
      return;
    }
    endPinchZoom();
  }

  const gestureLabels = [];

  for (const info of handData) {
    const state = handStates[info.handIndex];

    if (isPausePose(info.landmarks)) {
      const label = isOpenPalmPose(info.landmarks) ? 'OPEN_PALM' : 'FIST';
      gestureLabels.push(`${info.label}: ${label}`);
      continue;
    }

    if (!state.armed && !isHandPinching(info)) {
      gestureLabels.push(`${info.label}: stabilizing (${info.gesture})`);
      continue;
    }

    if (isSingleHandPinch(info)) {
      const otherHandPinching = handData.some(
        (h) => h.handIndex !== info.handIndex && isHandPinching(h),
      );
      if (!otherHandPinching) {
        const pinchPt = getPinchPointForHand(info);
        if (state.prevGesture !== Gesture.PINCH && state.isDrawing) {
          finishHandStroke(info.handIndex);
        }
        processPinchDrag(info.handIndex, pinchPt);
      }
      gestureLabels.push(`${info.label}: PINCH`);
      state.prevGesture = Gesture.PINCH;
      continue;
    }

    if (dragState.handIndex === info.handIndex && !isSingleHandPinch(info)) {
      endPinchDrag();
    }

    const g = processHandInteraction(info.landmarks, info.handIndex, info, now);
    gestureLabels.push(`${info.label}: ${g}`);
  }

  drawFingerPointers(handData);
  drawPipSkeleton(multi[0], connections, drawConnectors, drawLandmarks);

  const drawingBlocked = handData.some(
    (info) => handStates[info.handIndex].isDrawing && info.trackingOk === false,
  );
  gestureLabel.textContent = drawingBlocked
    ? 'Hand moving fast — tracking…'
    : gestureLabels.join(' · ');
}

// ─── Init ───────────────────────────────────────────────────────────────────────

function setupPanel() {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('creator-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const engineToggle = document.getElementById('engine-toggle');

  sidebarToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = sidebar?.classList.toggle('collapsed');
    app?.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.textContent = collapsed ? '›' : '‹';
    sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  });

  engineToggle?.addEventListener('click', () => {
    const open = engineToggle.classList.toggle('open');
    sidebar?.classList.toggle('engine-collapsed', !open);
    engineToggle.setAttribute('aria-expanded', String(open));
  });

  document.getElementById('sidebar-content')?.addEventListener('click', (e) => {
    const toggle = e.target.closest('.section-toggle');
    if (!toggle) return;
    e.preventDefault();
    const section = toggle.closest('.glass-section');
    if (!section) return;
    section.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(section.classList.contains('open')));
  });

  document.querySelectorAll('.section-toggle').forEach((btn) => {
    const section = btn.closest('.glass-section');
    btn.setAttribute('aria-expanded', String(section?.classList.contains('open')));
  });

  const guideSection = document.getElementById('guide-section');
  guideSection?.classList.add('open');
  setTimeout(() => guideSection?.classList.remove('open'), 20000);
}

function init() {
  setupCameraMirror();
  setupPointerOverlay();
  setupPanel();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  bindPointerEvents();
  wireToolbar();
  wirePdfImport();
  wireOcr();
  applyViewTransform();
  toggleCameraMirror(true);

  if (toolButtons.length) setActiveTool(toolButtons[0].dataset.mode);
  if (swatches.length) setActiveColor(swatches[0].dataset.color);

  initHandTracking();
}

init();
