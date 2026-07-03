/**
 * Gesture controller for GitHub Pages companion (docs/lib).
 */
import {
  GestureSmoother,
  PointSmoother,
  Gesture,
} from './gestureClassifier.js';
import { createGestureFrameProcessor } from './gesture-frame.js';
import { resolveRelayWs } from './gc-config.js';

function waitForMediaPipe(maxMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.Hands && window.Camera) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export async function initGestureController(options) {
  const {
    videoEl,
    statusEl,
    sessionInput,
    onSessionId,
    wsUrl: wsUrlOption,
    searchParams = new URLSearchParams(location.search),
  } = options;

  const gestureSmoother = new GestureSmoother(7);
  const pointSmoother = new PointSmoother(0.45);

  let mode = 'off';
  let tool = 'pen';
  let ws = null;
  let processing = false;
  let participantId = null;
  let relayWs = wsUrlOption || resolveRelayWs(searchParams, { preferPublic: true });

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function connectWs(sessionId) {
    if (ws) ws.close();
    if (!sessionId) return;

    relayWs = wsUrlOption || resolveRelayWs(searchParams, { preferPublic: true });
    if (!relayWs) {
      setStatus('No relay URL — add ?relay=wss://… or run npm run dev locally');
      return;
    }

    ws = new WebSocket(relayWs);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', role: 'companion', sessionId }));
      setStatus(`Connecting · ${sessionId}`);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'joined' && msg.participantId) {
          participantId = msg.participantId;
          setStatus(`Connected · ${sessionId.slice(0, 6)}…`);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => setStatus('Relay disconnected');
    ws.onerror = () => setStatus('WebSocket error');
  }

  function syncModeUi() {
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  function emitMode() {
    syncModeUi();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'mode',
        mode,
        tool,
        sessionId: sessionInput?.value.trim(),
        participantId,
      }));
    }
  }

  function emitGesture(gesture, nx, ny, extra = {}) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'gesture',
        gesture,
        nx,
        ny,
        mode,
        tool,
        sessionId: sessionInput?.value.trim(),
        participantId,
        ...extra,
      }));
    }
  }

  function bindModeButtons(root) {
    root.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        emitMode();
      });
    });
    root.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tool = btn.dataset.tool;
        root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
        emitMode();
      });
    });
  }

  if (sessionInput) {
    const onSession = () => {
      const id = sessionInput.value.trim();
      onSessionId?.(id);
      connectWs(id);
    };
    sessionInput.addEventListener('change', onSession);
    sessionInput.addEventListener('input', onSession);
  }

  const ready = await waitForMediaPipe();
  if (!ready || !window.Hands || !window.Camera) {
    setStatus('MediaPipe failed to load — reload page');
    return { bindModeButtons, connectWs, emitMode };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera requires HTTPS');
    return { bindModeButtons, connectWs, emitMode };
  }

  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });

  const frameProcessor = createGestureFrameProcessor({
    gestureSmoother,
    pointSmoother,
    onGesture: ({ gesture, nx, ny, pinchSep }) => {
      if (gesture === Gesture.THREE_FINGER) {
        if (mode === 'off') return;
        mode = mode === 'pointer' ? 'write' : 'pointer';
        emitMode();
        return;
      }
      emitGesture(gesture, nx, ny, pinchSep != null ? { pinchSep } : {});
    },
  });

  hands.onResults((results) => {
    frameProcessor.process(results);
  });

  if (typeof hands.initialize === 'function') await hands.initialize();

  const camera = new window.Camera(videoEl, {
    onFrame: async () => {
      if (processing) return;
      processing = true;
      try {
        await hands.send({ image: videoEl });
      } finally {
        processing = false;
      }
    },
    width: 640,
    height: 480,
  });

  await camera.start();
  setStatus('Camera on — pick mode below');

  return { bindModeButtons, connectWs, emitMode };
}
