/**
 * gestureClassifier.js
 * --------------------
 * Classifies hand landmarks (from MediaPipe Hands) into
 * named gestures used to control the canvas.
 */

export const Gesture = {
  DRAW:        'DRAW',
  ERASE:       'ERASE',
  PINCH:       'PINCH',
  FIST:        'FIST',
  OPEN_PALM:   'OPEN_PALM',
  THREE_FINGER: 'THREE_FINGER', // index + middle + ring — toggle pointer/write
  THUMBS_UP:   'THUMBS_UP',
  THUMBS_DOWN: 'THUMBS_DOWN',
  TWO_HAND_PINCH: 'TWO_HAND_PINCH',
  UNKNOWN:     'UNKNOWN',
};

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

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

function isFingerClearlyDown(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y > landmarks[pipIdx].y + 0.006;
}

function isFingerClearlyUp(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.006;
}

function nonThumbFingersCurled(landmarks) {
  return (
    isFingerClearlyDown(landmarks, 8, 6) &&
    isFingerClearlyDown(landmarks, 12, 10) &&
    isFingerClearlyDown(landmarks, 16, 14) &&
    isFingerClearlyDown(landmarks, 20, 18)
  );
}

export function isPeaceSignPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  return (
    isFingerClearlyUp(landmarks, 8, 6) &&
    isFingerClearlyUp(landmarks, 12, 10) &&
    isFingerClearlyDown(landmarks, 16, 14) &&
    isFingerClearlyDown(landmarks, 20, 18)
  );
}

function thumbSpreadRatio(landmarks) {
  return dist(landmarks[4], landmarks[5]) / handScale(landmarks);
}

export function isThumbsUpPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  if (!nonThumbFingersCurled(landmarks)) return false;
  if (thumbSpreadRatio(landmarks) < 0.52) return false;
  if (pinchRatio(landmarks) < 0.52) return false;
  const thumbTipUp = landmarks[4].y < landmarks[3].y - 0.008;
  const thumbAboveKnuckle = landmarks[4].y < landmarks[2].y;
  return thumbTipUp && thumbAboveKnuckle;
}

export function isThumbsDownPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  if (!nonThumbFingersCurled(landmarks)) return false;
  if (thumbSpreadRatio(landmarks) < 0.52) return false;
  if (pinchRatio(landmarks) < 0.52) return false;
  const thumbTipDown = landmarks[4].y > landmarks[3].y + 0.008;
  const thumbBelowKnuckle = landmarks[4].y > landmarks[2].y + 0.005;
  return thumbTipDown && thumbBelowKnuckle;
}

export function isFistPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  if (!nonThumbFingersCurled(landmarks)) return false;
  if (isThumbsUpPose(landmarks) || isThumbsDownPose(landmarks)) return false;
  // Tucked thumb against curled fingers
  return thumbSpreadRatio(landmarks) < 0.68 || pinchRatio(landmarks) < 0.72;
}

export function isOpenPalmPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const { indexUp, middleUp, ringUp, pinkyUp } = fingerExtension(landmarks);
  if (!(indexUp && middleUp && ringUp && pinkyUp)) return false;
  return !isPinchPose(landmarks);
}

export function isPausePose(landmarks) {
  return isFistPose(landmarks) || isOpenPalmPose(landmarks);
}

/** Thumb + index tips close; index must be extended (not a closed fist). */
export const PINCH_TOUCH_RATIO = 0.42;

export function isPinchPose(landmarks, threshold = PINCH_TOUCH_RATIO) {
  if (!landmarks || landmarks.length < 21) return false;
  if (!isFingerClearlyUp(landmarks, 8, 6)) return false;
  // Peace sign (index + middle up) is never pinch
  if (isFingerClearlyUp(landmarks, 12, 10)) return false;
  // Curled hand + extended thumb = thumbs up/down, not pinch
  if (nonThumbFingersCurled(landmarks)) return false;
  // Index only raised, thumb far away = draw/point, not pinch
  const othersCurled =
    isFingerClearlyDown(landmarks, 12, 10) &&
    isFingerClearlyDown(landmarks, 16, 14) &&
    isFingerClearlyDown(landmarks, 20, 18);
  if (othersCurled && pinchRatio(landmarks) > 0.48) return false;
  return pinchRatio(landmarks) < threshold;
}

export function isThreeFingerPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const { indexUp, middleUp, ringUp, pinkyUp } = fingerExtension(landmarks);
  return indexUp && middleUp && ringUp && !pinkyUp;
}

export function pinchMidpoint(landmarks) {
  return {
    x: (landmarks[8].x + landmarks[4].x) / 2,
    y: (landmarks[8].y + landmarks[4].y) / 2,
  };
}

export function twoHandPinchSeparation(multi) {
  if (!multi || multi.length < 2) return null;
  if (!isPinchPose(multi[0]) || !isPinchPose(multi[1])) return null;
  const a = pinchMidpoint(multi[0]);
  const b = pinchMidpoint(multi[1]);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

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

  if (isOpenPalmPose(landmarks)) {
    return { gesture: Gesture.OPEN_PALM, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  if (isThreeFingerPose(landmarks)) {
    return { gesture: Gesture.THREE_FINGER, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  if (isPeaceSignPose(landmarks)) {
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

  if (isThumbsUpPose(landmarks)) {
    return { gesture: Gesture.THUMBS_UP, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  if (isThumbsDownPose(landmarks)) {
    return { gesture: Gesture.THUMBS_DOWN, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

  if (isPinchPose(landmarks)) {
    return {
      gesture: Gesture.PINCH,
      drawPoint: pinchPoint,
      pinchDist,
      pinchRatio: ratio,
    };
  }

  if (isFistPose(landmarks)) {
    return { gesture: Gesture.FIST, drawPoint: null, pinchDist, pinchRatio: ratio };
  }

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

export class GestureSmoother {
  constructor(bufferSize = 7) {
    this.buffer = [];
    this.bufferSize = bufferSize;
  }

  push(gesture) {
    this.buffer.push(gesture);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
  }

  get() {
    if (this.buffer.length === 0) return Gesture.UNKNOWN;
    const counts = {};
    for (const g of this.buffer) counts[g] = (counts[g] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  reset() {
    this.buffer.length = 0;
  }
}

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
