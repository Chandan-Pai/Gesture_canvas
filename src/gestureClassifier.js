/**
 * gestureClassifier.js
 * --------------------
 * Classifies hand landmarks (from MediaPipe Hands) into
 * named gestures used to control the canvas.
 *
 * Landmark indices reference:
 * https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
 *
 * 0  WRIST
 * 1–4  THUMB  (1=CMC, 2=MCP, 3=IP, 4=TIP)
 * 5–8  INDEX  (5=MCP, 6=PIP, 7=DIP, 8=TIP)
 * 9–12 MIDDLE (9=MCP,10=PIP,11=DIP,12=TIP)
 * 13–16 RING  (13=MCP,14=PIP,15=DIP,16=TIP)
 * 17–20 PINKY (17=MCP,18=PIP,19=DIP,20=TIP)
 */

export const Gesture = {
  DRAW:        'DRAW',       // index finger up, others curled
  ERASE:       'ERASE',      // index + middle up (peace sign)
  PINCH:       'PINCH',      // index + thumb close together (for dragging/selecting)
  FIST:        'FIST',       // all fingers curled (pause)
  OPEN_PALM:   'OPEN_PALM',  // all fingers extended (pause / reset view hold)
  UNKNOWN:     'UNKNOWN',
};

// ── Helpers ────────────────────────────────────────────────────────────

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Wrist → index MCP distance; used for scale-invariant pinch threshold */
export function handScale(landmarks) {
  return Math.max(dist(landmarks[0], landmarks[5]), 0.04);
}

export function pinchRatio(landmarks) {
  return dist(landmarks[8], landmarks[4]) / handScale(landmarks);
}

function isFingerUp(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y;
}

function isThumbUp(landmarks) {
  // Compare tip x vs MCP x — works for both orientations
  return Math.abs(landmarks[4].x - landmarks[2].x) >
         Math.abs(landmarks[3].x - landmarks[2].x) * 0.5;
}

function fingerExtension(landmarks) {
  return {
    indexUp: isFingerUp(landmarks, 8, 6),
    middleUp: isFingerUp(landmarks, 12, 10),
    ringUp: isFingerUp(landmarks, 16, 14),
    pinkyUp: isFingerUp(landmarks, 20, 18),
    thumbUp: isThumbUp(landmarks),
  };
}

/** All four fingers curled — thumb may still sit near index tip */
export function isFistPose(landmarks) {
  const { indexUp, middleUp, ringUp, pinkyUp } = fingerExtension(landmarks);
  return !indexUp && !middleUp && !ringUp && !pinkyUp;
}

/** All four fingers extended — not when thumb and index are pinching */
export function isOpenPalmPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const { indexUp, middleUp, ringUp, pinkyUp } = fingerExtension(landmarks);
  if (!(indexUp && middleUp && ringUp && pinkyUp)) return false;
  return !isPinchPose(landmarks);
}

export function isPausePose(landmarks) {
  return isFistPose(landmarks) || isOpenPalmPose(landmarks);
}

/** Thumb + index tips close enough to count as touching (scale-invariant). */
export const PINCH_TOUCH_RATIO = 0.48;

/**
 * Pinch: thumb tip and index tip meet. Middle, ring, and pinky may be
 * open, half-curled, or down — only the thumb–index gap matters.
 */
export function isPinchPose(landmarks, threshold = PINCH_TOUCH_RATIO) {
  if (!landmarks || landmarks.length < 21) return false;
  return pinchRatio(landmarks) < threshold;
}

// ── Main classifier ────────────────────────────────────────────────────

/**
 * @param {Array} landmarks - Array of {x, y, z} from MediaPipe
 * @returns {{ gesture: string, drawPoint: {x, y}|null, pinchDist: number }}
 */
export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { gesture: Gesture.UNKNOWN, drawPoint: null, pinchDist: Infinity };
  }

  const { indexUp, middleUp, ringUp, pinkyUp } = fingerExtension(landmarks);

  const pinchDist = dist(landmarks[8], landmarks[4]);
  const ratio = pinchDist / handScale(landmarks);
  const pinchPoint = {
    x: (landmarks[8].x + landmarks[4].x) / 2,
    y: (landmarks[8].y + landmarks[4].y) / 2,
  };

  // PINCH first: thumb + index tips touching (other fingers unrestricted)
  if (isPinchPose(landmarks)) {
    return {
      gesture: Gesture.PINCH,
      drawPoint: pinchPoint,
      pinchDist,
      pinchRatio: ratio,
    };
  }

  // OPEN PALM: all four fingers up, not pinching
  if (indexUp && middleUp && ringUp && pinkyUp) {
    return { gesture: Gesture.OPEN_PALM, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  // FIST: all fingers curled
  if (isFistPose(landmarks)) {
    return { gesture: Gesture.FIST, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  // ERASE: peace sign — index + middle up, thumb away from index
  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    return {
      gesture: Gesture.ERASE,
      drawPoint: {
        x: (landmarks[8].x + landmarks[12].x) / 2,
        y: (landmarks[8].y + landmarks[12].y) / 2,
      },
      pinchDist,
      pinchRatio: ratio,
    };
  }

  // DRAW: only index finger up
  if (indexUp && !middleUp) {
    return {
      gesture: Gesture.DRAW,
      drawPoint: { x: landmarks[8].x, y: landmarks[8].y },
      pinchDist,
      pinchRatio: ratio,
    };
  }

  return { gesture: Gesture.UNKNOWN, drawPoint: null, pinchDist, pinchRatio: ratio };
}

// ── Gesture smoothing ──────────────────────────────────────────────────

/**
 * Simple majority-vote buffer to avoid flickering between gestures.
 */
export class GestureSmoother {
  constructor(bufferSize = 5) {
    this.buffer = [];
    this.bufferSize = bufferSize;
  }

  push(gesture) {
    this.buffer.push(gesture);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
  }

  /** Returns the most frequent gesture in the buffer */
  get() {
    if (this.buffer.length === 0) return Gesture.UNKNOWN;
    const counts = {};
    for (const g of this.buffer) counts[g] = (counts[g] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
}

// ── Point smoothing ────────────────────────────────────────────────────

/**
 * Exponential moving average for draw point to reduce jitter.
 */
export class PointSmoother {
  constructor(alpha = 0.4) {
    this.alpha = alpha;
    this.prev  = null;
  }

  smooth(pt) {
    if (!pt) return null;
    if (!this.prev) { this.prev = pt; return pt; }
    const smoothed = {
      x: this.alpha * pt.x + (1 - this.alpha) * this.prev.x,
      y: this.alpha * pt.y + (1 - this.alpha) * this.prev.y,
    };
    this.prev = smoothed;
    return smoothed;
  }

  reset() { this.prev = null; }
}
