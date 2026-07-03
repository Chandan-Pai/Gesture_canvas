import { createOverlayController, buildToolbar } from './lib/overlay-core.js';

const PORT_NAME = 'screen-overlay';
const port = chrome.runtime.connect({ name: PORT_NAME });

const root = document.getElementById('gc-root');
const laserCanvas = document.getElementById('gc-laser');
const inkCanvas = document.getElementById('gc-ink');
const banner = document.getElementById('gc-banner');
const toolbarMount = document.getElementById('gc-toolbar-mount');

const toolbar = buildToolbar();
toolbarMount.replaceWith(toolbar);

const ctrl = createOverlayController({
  root,
  laserCanvas,
  inkCanvas,
  toolbar,
  banner,
  bannerText: 'In Meet: Present → Entire screen (this monitor)',
  defaultMode: 'pointer',
});

function handleMessage(msg) {
  if (msg.type === 'session-start') {
    ctrl.setMode('pointer');
    ctrl.showBanner(true);
    setTimeout(() => ctrl.showBanner(false), 8000);
    return;
  }

  if (msg.type === 'session-end') {
    ctrl.destroy();
    window.close();
    return;
  }

  if (msg.type === 'mode') {
    if (msg.mode) ctrl.setMode(msg.mode);
    if (msg.tool) ctrl.setTool(msg.tool);
    return;
  }

  if (msg.type === 'gesture') {
    ctrl.handleGesture(msg);
    return;
  }

  if (msg.type === 'export-request') {
    const payload = { ...ctrl.getExportPayload(), compositeDataUrl: null };
    port.postMessage({ type: 'export-request-result', ...payload });
    return;
  }
}

port.onMessage.addListener((msg) => {
  handleMessage(msg);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'companion-gesture' || msg.type === 'companion-mode') {
    return false;
  }

  const handled = new Set([
    'overlay-ready',
    'session-start',
    'session-end',
    'mode',
    'gesture',
    'export-request',
  ]);
  if (!handled.has(msg.type)) {
    return false;
  }

  handleMessage(msg);
  if (msg.type === 'overlay-ready') {
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: true });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'p' || e.key === 'P') ctrl.setMode('pointer');
  if (e.key === 'w' || e.key === 'W') ctrl.setMode('write');
  if (e.key === 'Escape') ctrl.setMode('off');
});

ctrl.setMode('pointer');
ctrl.showBanner(true);
setTimeout(() => ctrl.showBanner(false), 8000);

chrome.runtime.sendMessage({ type: 'overlay-ready' }).catch(() => {});
