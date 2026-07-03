/**
 * Shared gesture controller — extension page + phone companion + GitHub Pages
 */
import {
  GestureSmoother,
  PointSmoother,
  Gesture,
} from '../lib/gestureClassifier.js';
import { createGestureFrameProcessor } from '../lib/gesture-frame.js';
import { resolveRelayWs } from '../lib/gc-config.js';
import {
  attachStream,
  queryCameraPermission,
  requestCameraStream,
  startFrameLoop,
  stopCameraStream,
} from '../lib/camera-access.js';
import '../lib/mediapipe-log-filter.js';

/** Wait for MediaPipe Hands script */
function waitForMediaPipe(maxMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.Hands) {
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

function earlyReturn(bindModeButtons, connectWs, emitMode, getRelayWs = () => null) {
  return {
    setMode: (m) => {
      mode = m;
      emitMode();
    },
    bindModeButtons,
    connectWs,
    emitMode,
    getRelayWs,
  };
}

function setCameraView(cameraUi, view) {
  if (!cameraUi) return;
  const { permissionPanel, promptView, blockedView, controlsRoot } = cameraUi;
  permissionPanel?.classList.toggle('hidden', view === 'granted');
  promptView?.classList.toggle('hidden', view !== 'prompt');
  blockedView?.classList.toggle('hidden', view !== 'blocked');
  controlsRoot?.classList.toggle('hidden', view !== 'granted');
}

export async function initGestureController(options) {
  const {
    videoEl,
    statusEl,
    sessionInput,
    onSessionId,
    sendGesture,
    sendMode,
    wsUrl: wsUrlOption,
    searchParams = new URLSearchParams(location.search),
    cameraUi = null,
    pageBroadcast = true,
  } = options;

  const gestureSmoother = new GestureSmoother(7);
  const pointSmoother = new PointSmoother(0.45);

  let mode = 'pointer';
  let tool = 'pen';
  let ws = null;
  let cameraStream = null;
  let stopFrameLoop = null;
  let participantId = null;
  let participantColor = null;
  let relayWs = wsUrlOption || resolveRelayWs(searchParams);

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function connectWs(sessionId) {
    if (ws) ws.close();
    if (!sessionId) return;

    relayWs = wsUrlOption || resolveRelayWs(searchParams);
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
          participantColor = msg.color;
          setStatus(`Connected · ${sessionId.slice(0, 6)}…`);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (cameraStream) {
        setStatus('Relay disconnected — gestures still work via extension');
      } else {
        setStatus('Relay disconnected — run npm run dev or check relay URL');
      }
    };
    ws.onerror = () => setStatus('WebSocket error — check relay URL');
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
    const payload = { mode, tool, participantId };
    sendMode?.({ type: 'mode', mode, tool, participantId });
    if (pageBroadcast) {
      window.postMessage(
        { source: 'gesture-canvas', gcType: 'companion-mode', payload },
        '*',
      );
    }
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
    const payload = {
      gesture,
      nx,
      ny,
      mode,
      tool,
      participantId,
      participantColor,
      ...extra,
    };
    sendGesture?.({ type: 'gesture', ...payload });
    if (pageBroadcast) {
      window.postMessage(
        { source: 'gesture-canvas', gcType: 'companion-gesture', payload },
        '*',
      );
    }
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
  const HandsCtor = window.Hands;

  if (!ready || !HandsCtor) {
    setStatus(
      'MediaPipe failed to load — use https://localhost:3000/companion/ or the GitHub Pages companion',
    );
    return earlyReturn(bindModeButtons, connectWs, emitMode);
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera requires HTTPS');
    return earlyReturn(bindModeButtons, connectWs, emitMode);
  }

  const handsAssetBase =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? (file) => chrome.runtime.getURL(`vendor/mediapipe/hands/${file}`)
      : (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;

  const hands = new HandsCtor({
    locateFile: handsAssetBase,
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

  async function startCamera() {
    if (cameraStream) return true;

    if (cameraUi?.useTabGrant) {
      const perm = await queryCameraPermission();
      if (perm !== 'granted') {
        setStatus('Allow camera in the tab that opens…');
        cameraUi.openGrantTab?.();
        return false;
      }
    }

    try {
      const stream = await requestCameraStream();
      cameraStream = stream;
      await attachStream(videoEl, stream);
      stopFrameLoop = startFrameLoop(videoEl, () => hands.send({ image: videoEl }));
      setCameraView(cameraUi, 'granted');
      setStatus('Camera on — presenter panel (not shared in Meet)');
      return true;
    } catch (err) {
      const name = err?.name || 'Error';
      console.warn('Failed to acquire camera feed:', err);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraView(cameraUi, 'blocked');
        setStatus('Camera blocked — follow the steps below');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraView(cameraUi, cameraUi ? 'blocked' : 'granted');
        setStatus('No camera found — plug in a webcam and try again');
      } else {
        setCameraView(cameraUi, cameraUi ? 'blocked' : 'granted');
        setStatus(`Camera error: ${name}`);
      }
      return false;
    }
  }

  function bindCameraUi() {
    if (!cameraUi) return;

    cameraUi.permissionPanel?.classList.remove('hidden');

    cameraUi.allowBtn?.addEventListener('click', async () => {
      if (cameraUi.useTabGrant) {
        const perm = await queryCameraPermission();
        if (perm === 'granted') {
          setStatus('Starting camera…');
          startCamera();
          return;
        }
        setStatus('Opening camera permission page…');
        cameraUi.openGrantTab?.();
        return;
      }
      setStatus('Waiting for Chrome camera prompt…');
      startCamera();
    });

    cameraUi.retryBtn?.addEventListener('click', async () => {
      if (cameraUi.useTabGrant) {
        const perm = await queryCameraPermission();
        if (perm === 'granted') {
          setStatus('Starting camera…');
          startCamera();
          return;
        }
        setStatus('Opening camera permission page…');
        cameraUi.openGrantTab?.();
        return;
      }
      setStatus('Requesting camera…');
      startCamera();
    });

    cameraUi.settingsBtn?.addEventListener('click', () => {
      cameraUi.openSettings?.();
    });
  }

  bindCameraUi();

  if (cameraUi) {
    const perm = await queryCameraPermission();
    if (perm === 'granted') {
      await startCamera();
    } else if (perm === 'denied') {
      setCameraView(cameraUi, 'blocked');
      setStatus('Camera blocked — follow the steps below');
    } else {
      setCameraView(cameraUi, 'prompt');
      setStatus('Allow camera to start gesture control');
    }
  } else {
    const ok = await startCamera();
    if (!ok) {
      return earlyReturn(bindModeButtons, connectWs, emitMode);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!cameraStream) return;
    if (document.hidden) {
      setStatus('Keep this window visible — camera pauses when hidden');
    } else if (ws?.readyState === WebSocket.OPEN && sessionInput?.value.trim()) {
      setStatus(`Connected · ${sessionInput.value.trim().slice(0, 6)}…`);
    } else {
      setStatus('Camera on — keep this window open while presenting');
    }
  });

  return {
    setMode: (m) => {
      mode = m;
      emitMode();
    },
    bindModeButtons,
    connectWs,
    emitMode,
    getRelayWs: () => relayWs,
    startCamera,
    stopCamera: () => {
      stopFrameLoop?.();
      stopFrameLoop = null;
      stopCameraStream(cameraStream, videoEl);
      cameraStream = null;
    },
  };
}
