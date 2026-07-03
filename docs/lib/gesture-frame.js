/**
 * Shared MediaPipe → gesture emit logic (side panel, companion, relay).
 */
import {
  classifyGesture,
  Gesture,
  GestureSmoother,
  PointSmoother,
  isPinchPose,
  pinchMidpoint,
  twoHandPinchSeparation,
} from './gestureClassifier.js';

const POINT_GESTURES = new Set([Gesture.DRAW, Gesture.ERASE, Gesture.PINCH]);
/** One-shot gestures — THREE_FINGER handled separately so it does not block the smoother */
const DISCRETE_GESTURES = new Set([Gesture.THUMBS_UP, Gesture.THUMBS_DOWN]);

/**
 * @param {{ gestureSmoother?: GestureSmoother, pointSmoother?: PointSmoother, onGesture: (payload: object) => void }} options
 */
export function createGestureFrameProcessor(options) {
  const gestureSmoother = options.gestureSmoother ?? new GestureSmoother(5);
  const pointSmoother = options.pointSmoother ?? new PointSmoother(0.45);
  const onGesture = options.onGesture;

  let lastDiscreteGesture = null;
  let lastThreeFinger = false;

  function process(results) {
    const multi = results.multiHandLandmarks;
    if (!multi?.length) {
      lastDiscreteGesture = null;
      lastThreeFinger = false;
      gestureSmoother.reset();
      pointSmoother.reset();
      return;
    }

    const pinchSep = twoHandPinchSeparation(multi);
    if (pinchSep != null) {
      onGesture({ gesture: Gesture.TWO_HAND_PINCH, nx: null, ny: null, pinchSep });
      return;
    }

    const lm = multi[0];
    const raw = classifyGesture(lm);

    // Mode toggle — raw edge detect, never fed into smoother (would block DRAW/PINCH/etc.)
    if (raw.gesture === Gesture.THREE_FINGER) {
      if (!lastThreeFinger) {
        lastThreeFinger = true;
        onGesture({ gesture: Gesture.THREE_FINGER, nx: null, ny: null });
      }
      return;
    }
    lastThreeFinger = false;

    gestureSmoother.push(raw.gesture);
    const gesture = gestureSmoother.get();

    let nx = null;
    let ny = null;
    if (raw.drawPoint && POINT_GESTURES.has(gesture)) {
      const pt = pointSmoother.smooth(raw.drawPoint);
      nx = pt.x;
      ny = pt.y;
    } else if (!POINT_GESTURES.has(gesture)) {
      pointSmoother.reset();
    }

    if (gesture === Gesture.UNKNOWN) return;

    if (DISCRETE_GESTURES.has(gesture)) {
      if (gesture === lastDiscreteGesture) return;
      lastDiscreteGesture = gesture;
      onGesture({ gesture, nx, ny });
      return;
    }

    lastDiscreteGesture = null;

    if (POINT_GESTURES.has(gesture) && (nx == null || ny == null)) return;

    onGesture({ gesture, nx, ny });
  }

  return {
    process,
    gestureSmoother,
    pointSmoother,
    resetDiscrete() {
      lastDiscreteGesture = null;
      lastThreeFinger = false;
    },
  };
}

export { Gesture, GestureSmoother, PointSmoother, isPinchPose, pinchMidpoint };
