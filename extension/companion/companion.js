import { initGestureController } from './gesture-controller.js';

const statusEl = document.getElementById('status');
const videoEl = document.getElementById('webcam');

function sendGesture(payload) {
  const { type: _t, ...rest } = payload;
  chrome.runtime.sendMessage({ type: 'companion-gesture', ...rest }).catch(() => {});
}

function sendMode(payload) {
  const { type: _t, ...rest } = payload;
  chrome.runtime.sendMessage({ type: 'companion-mode', ...rest }).catch(() => {});
}

const ctrl = await initGestureController({
  videoEl,
  statusEl,
  sendGesture,
  sendMode,
});

ctrl.bindModeButtons(document.body);
ctrl.emitMode();

const { gcSession } = await chrome.storage.local.get('gcSession');
if (gcSession?.id) {
  statusEl.textContent = `Session ${gcSession.id} — pick mode`;
}
