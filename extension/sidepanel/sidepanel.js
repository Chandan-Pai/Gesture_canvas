/**
 * Presenter-only gesture controller (Chrome side panel, extension origin).
 * Camera permission must be granted in a separate tab (Chrome blocks prompts in side panels).
 */
import { initGestureController } from '../companion/gesture-controller.js';

const PRESENTER_PORT_NAME = 'presenter-gestures';
const PORT_QUEUE_MAX = 90;

const statusEl = document.getElementById('status');
const videoEl = document.getElementById('webcam');

/** @type {chrome.runtime.Port | null} */
let presenterPort = null;
/** @type {object[]} */
let portQueue = [];

function flushPortQueue() {
  if (!presenterPort) return;
  while (portQueue.length) {
    try {
      presenterPort.postMessage(portQueue.shift());
    } catch {
      presenterPort = null;
      portQueue.length = 0;
      schedulePortReconnect();
      return;
    }
  }
}

let reconnectTimer = null;
function schedulePortReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPresenterPort();
  }, 300);
}

function connectPresenterPort() {
  try {
    presenterPort?.disconnect();
  } catch {
    /* ignore */
  }

  try {
    presenterPort = chrome.runtime.connect({ name: PRESENTER_PORT_NAME });
  } catch {
    presenterPort = null;
    schedulePortReconnect();
    return;
  }

  presenterPort.onMessage.addListener((msg) => {
    if (msg.type === 'presenter-port-ready') flushPortQueue();
  });

  presenterPort.onDisconnect.addListener(() => {
    presenterPort = null;
    schedulePortReconnect();
  });

  flushPortQueue();
}

function postPresenter(msg) {
  if (presenterPort) {
    try {
      presenterPort.postMessage(msg);
      return;
    } catch {
      presenterPort = null;
      schedulePortReconnect();
    }
  }

  portQueue.push(msg);
  if (portQueue.length > PORT_QUEUE_MAX) portQueue.shift();
}

function sendGesture(payload) {
  const { type: _t, ...rest } = payload;
  postPresenter({ type: 'companion-gesture', ...rest });
}

function sendMode(payload) {
  const { type: _t, ...rest } = payload;
  postPresenter({ type: 'companion-mode', ...rest });
}

connectPresenterPort();

const params = new URLSearchParams(location.search);
let sessionId = params.get('session') || '';

if (!sessionId) {
  const { gcSession } = await chrome.storage.local.get('gcSession');
  sessionId = gcSession?.id || '';
}

const sessionInput = { value: sessionId, addEventListener: () => {} };

const cameraUi = {
  permissionPanel: document.getElementById('camera-permission'),
  promptView: document.getElementById('camera-prompt'),
  blockedView: document.getElementById('camera-blocked'),
  controlsRoot: document.getElementById('camera-controls'),
  allowBtn: document.getElementById('btn-allow-camera'),
  retryBtn: document.getElementById('btn-retry-camera'),
  settingsBtn: document.getElementById('btn-camera-settings'),
  useTabGrant: true,
  openGrantTab: () =>
    chrome.runtime.sendMessage({ type: 'open-camera-grant' }).catch(() => {}),
  openSettings: () =>
    chrome.runtime.sendMessage({ type: 'open-camera-settings' }).catch(() => {}),
};

const ctrl = await initGestureController({
  videoEl,
  statusEl,
  sessionInput,
  sendGesture,
  sendMode,
  cameraUi,
  pageBroadcast: false,
  onSessionId: (id) => {
    if (id) ctrl.connectWs(id);
  },
});

ctrl.bindModeButtons(document.body);
ctrl.emitMode();

if (sessionId) {
  ctrl.connectWs(sessionId);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'camera-grant-complete') {
    statusEl.textContent = 'Camera allowed — starting…';
    ctrl.startCamera();
    return;
  }
  if (msg.type === 'overlay-reconnected') {
    statusEl.textContent = 'Overlay reconnected — gestures active';
    return;
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.gcSession?.newValue?.id) {
    sessionId = changes.gcSession.newValue.id;
    sessionInput.value = sessionId;
    ctrl.connectWs(sessionId);
  }
});
