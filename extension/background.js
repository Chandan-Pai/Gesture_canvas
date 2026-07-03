/**
 * Gesture Canvas extension — service worker
 */
import {
  companionUrl,
  relayPageUrl,
} from './lib/gc-config.js';

const DEFAULT_COLOR = '#ff1a1a';
const SCREEN_PORT_NAME = 'screen-overlay';
const TAB_PORT_NAME = 'tab-overlay';
const PRESENTER_PORT_NAME = 'presenter-gestures';

/** @type {number | null} */
let relayTabId = null;
/** @type {object | null} */
let session = null;
/** @type {chrome.runtime.Port | null} */
let screenOverlayPort = null;
/** @type {chrome.runtime.Port | null} */
let tabOverlayPort = null;
/** @type {number | null} */
let tabOverlayPortTabId = null;
/** Last injected Slides/presentation URL key (pathname) for the session tab */
let lastOverlayUrlKey = '';
let reinjectInFlight = false;

const GOOGLE_SLIDES_RE =
  /^https:\/\/docs\.google\.com\/presentation\/d\/[a-zA-Z0-9_-]+/;

function slidesUrlKey(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('#')[0];
  }
}

function isGoogleSlidesUrl(url) {
  return GOOGLE_SLIDES_RE.test(url || '');
}

function isPresentationContentUrl(url) {
  if (isGoogleSlidesUrl(url)) return true;
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'docs.google.com' || host.endsWith('.slides.google.com');
  } catch {
    return false;
  }
}

function broadcastToExtensionPages(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function reinjectTabOverlay(tabId, url, { reconnected = false } = {}) {
  if (reinjectInFlight) return false;
  if (!session || session.surface !== 'tab' || session.tabId !== tabId) return false;

  reinjectInFlight = true;
  tabOverlayPort = null;
  tabOverlayPortTabId = null;

  try {
    await injectOverlay(tabId);
    lastOverlayUrlKey = slidesUrlKey(url);

    const ready = await waitForOverlayReady(tabId);
    if (!ready) return false;

    await notifyOverlayStart();
    if (reconnected) {
      await sendOverlayMessage({ type: 'overlay-reconnected' });
      broadcastToExtensionPages({ type: 'overlay-reconnected' });
    }

    session.pageUrl = url;
    await saveSession();
    return true;
  } finally {
    reinjectInFlight = false;
  }
}

async function maybeReinjectOnTabNavigation(tabId, url) {
  if (reinjectInFlight) return;
  if (!session || session.surface !== 'tab' || session.tabId !== tabId) return;
  if (!isPresentationContentUrl(url)) return;

  const key = slidesUrlKey(url);
  const portLive = tabOverlayPort && tabOverlayPortTabId === tabId;

  if (key === lastOverlayUrlKey && portLive) return;

  const reconnected = lastOverlayUrlKey !== '' && lastOverlayUrlKey !== key;
  await reinjectTabOverlay(tabId, url, { reconnected: reconnected || !portLive });
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function overlayTabId() {
  if (!session) return null;
  if (session.surface === 'screen') return session.overlayTabId;
  return session.tabId;
}

function isScreenOverlay() {
  return session?.surface === 'screen';
}

async function saveSession() {
  if (session) {
    await chrome.storage.local.set({ gcSession: session });
  } else {
    await chrome.storage.local.remove('gcSession');
  }
}

async function loadSession() {
  const { gcSession } = await chrome.storage.local.get('gcSession');
  if (!gcSession?.id) return;

  try {
    if (gcSession.surface === 'screen' && gcSession.overlayTabId) {
      await chrome.tabs.get(gcSession.overlayTabId);
    } else if (gcSession.tabId) {
      await chrome.tabs.get(gcSession.tabId);
    } else {
      throw new Error('invalid session');
    }
    session = gcSession;
    await ensureRelayTab();
    if (session.surface === 'tab' && session.tabId) {
      await restoreTabOverlay().catch(() => {});
      await configurePresenterSidePanel(session.tabId, session.id).catch(() => {});
    }
  } catch {
    session = null;
    relayTabId = null;
    screenOverlayPort = null;
    tabOverlayPort = null;
    tabOverlayPortTabId = null;
    await saveSession();
  }
}

/**
 * Relay runs in a normal tab (not the service worker) so browser TLS trust applies.
 * Gestures also arrive via companion-bridge postMessage from the companion page.
 */
async function ensureRelayTab() {
  if (!session?.id) return;

  if (relayTabId != null) {
    try {
      await chrome.tabs.get(relayTabId);
      return;
    } catch {
      relayTabId = null;
    }
  }

  const url = relayPageUrl(session.id);
  const tab = await chrome.tabs.create({ url, active: false, pinned: true });
  relayTabId = tab.id;
}

async function closeRelayTab() {
  if (relayTabId != null) {
    try {
      await chrome.tabs.remove(relayTabId);
    } catch {
      /* ignore */
    }
    relayTabId = null;
  }
}

function sidePanelPath(sessionId) {
  return `sidepanel/index.html?session=${encodeURIComponent(sessionId)}`;
}

/** Presenter panel — Chrome side bar; not captured in Meet tab share. */
async function configurePresenterSidePanel(tabId, sessionId) {
  if (!tabId || !sessionId) return;
  await chrome.sidePanel.setOptions({
    tabId,
    path: sidePanelPath(sessionId),
    enabled: true,
  });
}

async function openPresenterSidePanel(tabId) {
  if (!tabId) return;
  try {
    await chrome.sidePanel.open({ tabId });
  } catch {
    /* may need a user gesture from popup */
  }
}

async function closePresenterSidePanel(tabId) {
  if (!tabId) return;
  try {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  } catch {
    /* ignore */
  }
}

async function injectOverlay(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'session-end' }).catch(() => {});

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/overlay.css'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/overlay.js'],
  });
}

const BLOCKED_TAB_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^https?:\/\/localhost:3000\/companion/,
  /^https?:\/\/127\.0\.0\.1:3000\/companion/,
  /relay-client\.html/,
];

function validatePresentationTab(tab) {
  const url = tab.url || '';
  if (!url || url === 'about:blank') {
    throw new Error('Open your presentation page (Slides, doc, etc.) first, then Start on this tab.');
  }
  if (BLOCKED_TAB_PATTERNS.some((re) => re.test(url))) {
    throw new Error(
      'Wrong tab — click your Slides or presentation page first, not the gesture controller or relay.',
    );
  }
}

async function getPrimaryDisplayBounds() {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  if (!primary?.bounds) {
    return { left: 0, top: 0, width: 1920, height: 1080 };
  }
  return primary.bounds;
}

function waitForScreenOverlayPort(maxMs = 12000) {
  if (screenOverlayPort) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (screenOverlayPort) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

function waitForTabOverlayPort(tabId, maxMs = 12000) {
  if (tabOverlayPort && tabOverlayPortTabId === tabId) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (tabOverlayPort && tabOverlayPortTabId === tabId) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

/** Deliver to overlay via Port (reliable); fall back to tabs.sendMessage. */
async function sendOverlayMessage(message) {
  const tabId = overlayTabId();
  if (!tabId) return null;

  if (isScreenOverlay()) {
    if (screenOverlayPort) {
      screenOverlayPort.postMessage(message);
      return { ok: true };
    }
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      return null;
    }
  }

  if (tabOverlayPort && tabOverlayPortTabId === tabId) {
    tabOverlayPort.postMessage(message);
    return { ok: true };
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function sendOverlayMessageWithResponse(message, timeoutMs = 8000) {
  const tabId = overlayTabId();
  if (!tabId) return null;

  if (!isScreenOverlay() && tabOverlayPort && tabOverlayPortTabId === tabId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        tabOverlayPort?.onMessage.removeListener(onReply);
        reject(new Error('Tab overlay export timeout'));
      }, timeoutMs);

      function onReply(reply) {
        if (reply?.type === `${message.type}-result` || reply?.inkDataUrl) {
          clearTimeout(timer);
          tabOverlayPort?.onMessage.removeListener(onReply);
          resolve(reply);
        }
      }

      tabOverlayPort.onMessage.addListener(onReply);
      tabOverlayPort.postMessage(message);
    });
  }

  if (isScreenOverlay() && screenOverlayPort) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        screenOverlayPort?.onMessage.removeListener(onReply);
        reject(new Error('Screen overlay export timeout'));
      }, timeoutMs);

      function onReply(reply) {
        if (reply?.type === `${message.type}-result`) {
          clearTimeout(timer);
          screenOverlayPort?.onMessage.removeListener(onReply);
          resolve(reply);
        }
      }

      screenOverlayPort.onMessage.addListener(onReply);
      screenOverlayPort.postMessage(message);
    });
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function waitForOverlayReady(tabId, maxMs = 8000) {
  if (isScreenOverlay()) {
    return waitForScreenOverlayPort(maxMs);
  }

  const portOk = await waitForTabOverlayPort(tabId, maxMs);
  if (portOk) return true;

  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'overlay-ready' });
      if (res?.ok) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

async function notifyOverlayStart() {
  if (!overlayTabId()) return;
  await sendOverlayMessage({
    type: 'session-start',
    session,
  });
}

function buildSessionBase(id, name, surface) {
  return {
    id,
    name: name || `session-${id}`,
    surface,
    tabId: null,
    overlayTabId: null,
    overlayWindowId: null,
    pageUrl: '',
    pageTitle: '',
    startedAt: new Date().toISOString(),
    mode: 'off',
    tool: 'pen',
    color: DEFAULT_COLOR,
  };
}

async function restoreTabOverlay() {
  if (!session?.tabId || session.surface !== 'tab') return;
  await ensureRelayTab();
  const tab = await chrome.tabs.get(session.tabId);
  await reinjectTabOverlay(session.tabId, tab.url || session.pageUrl, { reconnected: false });
}

async function startTabSession(tabId, name) {
  const id = randomId();
  const tab = await chrome.tabs.get(tabId);
  validatePresentationTab(tab);

  session = buildSessionBase(id, name, 'tab');
  session.tabId = tabId;
  session.pageUrl = tab.url || '';
  session.pageTitle = tab.title || '';

  await saveSession();
  await ensureRelayTab();

  const ok = await reinjectTabOverlay(tabId, tab.url || '', { reconnected: false });
  if (!ok) {
    session = null;
    lastOverlayUrlKey = '';
    await saveSession();
    throw new Error('Overlay failed to load — refresh this tab and try again.');
  }

  await configurePresenterSidePanel(tabId, session.id);
  await openPresenterSidePanel(tabId);
  return { session, presentationTabId: tabId };
}

async function startScreenSession(name) {
  if (session) await endSession();

  screenOverlayPort = null;
  const id = randomId();
  const bounds = await getPrimaryDisplayBounds();
  const overlayUrl = chrome.runtime.getURL('screen-overlay.html');

  const win = await chrome.windows.create({
    url: overlayUrl,
    type: 'popup',
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    focused: false,
  });

  const [tab] = await chrome.tabs.query({ windowId: win.id });
  if (!tab?.id) throw new Error('Screen overlay failed to open');

  session = buildSessionBase(id, name || `webinar-${id}`, 'screen');
  session.overlayWindowId = win.id;
  session.overlayTabId = tab.id;
  session.pageTitle = 'Screen pointer (webinar)';
  session.pageUrl = 'screen-overlay';

  await saveSession();
  await ensureRelayTab();

  const ready = await waitForOverlayReady(tab.id);
  if (!ready) {
    throw new Error('Screen overlay did not connect — reload extension and retry');
  }

  await notifyOverlayStart();
  await configurePresenterSidePanel(tab.id, session.id);
  return { session, presentationTabId: tab.id };
}

async function endSession() {
  const endedTabId = session?.surface === 'tab' ? session.tabId : session?.overlayTabId;
  if (session?.surface === 'screen' && session.overlayWindowId != null) {
    try {
      await sendOverlayMessage({ type: 'session-end' });
      await chrome.windows.remove(session.overlayWindowId);
    } catch {
      /* ignore */
    }
  } else if (session?.tabId) {
    await sendOverlayMessage({ type: 'session-end' });
  }

  screenOverlayPort = null;
  tabOverlayPort = null;
  tabOverlayPortTabId = null;
  lastOverlayUrlKey = '';
  await closeRelayTab();
  if (endedTabId) await closePresenterSidePanel(endedTabId);
  session = null;
  await saveSession();
}

async function exportSession() {
  const tabId = overlayTabId();
  if (!tabId) throw new Error('No active session');

  const payload = isScreenOverlay() || (tabOverlayPort && tabOverlayPortTabId === tabId)
    ? await sendOverlayMessageWithResponse({ type: 'export-request' })
    : await chrome.tabs.sendMessage(tabId, { type: 'export-request' });

  if (!payload?.inkDataUrl) throw new Error('Export failed — reload and retry');

  let compositeDataUrl = payload.inkDataUrl;

  if (session.surface === 'tab') {
    try {
      const tab = await chrome.tabs.get(tabId);
      const pageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      compositeDataUrl = await compositeImages(pageDataUrl, payload.inkDataUrl);
    } catch {
      /* ink-only fallback */
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = session.name.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 40);
  const base = `${safeName}_${stamp}`;

  await chrome.downloads.download({
    url: compositeDataUrl,
    filename: `gesture-canvas/${base}/composite.png`,
    saveAs: true,
  });

  const meta = {
    sessionName: session.name,
    sessionId: session.id,
    surface: session.surface,
    pageUrl: session.pageUrl,
    pageTitle: session.pageTitle,
    startedAt: session.startedAt,
    endedAt: new Date().toISOString(),
    strokeCount: payload.strokeCount ?? 0,
    exportedAt: new Date().toISOString(),
  };

  const metaBlob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
  const metaUrl = URL.createObjectURL(metaBlob);
  await chrome.downloads.download({
    url: metaUrl,
    filename: `gesture-canvas/${base}/meta.json`,
  });
  setTimeout(() => URL.revokeObjectURL(metaUrl), 5000);

  if (payload.strokesJson) {
    const strokesBlob = new Blob([payload.strokesJson], { type: 'application/json' });
    const strokesUrl = URL.createObjectURL(strokesBlob);
    await chrome.downloads.download({
      url: strokesUrl,
      filename: `gesture-canvas/${base}/strokes.json`,
    });
    setTimeout(() => URL.revokeObjectURL(strokesUrl), 5000);
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function compositeImages(pageDataUrl, inkDataUrl) {
  const [pageImg, inkImg] = await Promise.all([
    loadImage(pageDataUrl),
    loadImage(inkDataUrl),
  ]);
  const w = pageImg.naturalWidth || pageImg.width;
  const h = pageImg.naturalHeight || pageImg.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(pageImg, 0, 0, w, h);
  ctx.drawImage(inkImg, 0, 0, inkImg.width, inkImg.height, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return URL.createObjectURL(blob);
}

/** Run in the page (MAIN world) so Google Slides receives navigation input. */
let lastSlideNavAt = 0;

async function navigatePresentationTab(direction) {
  const tabId = overlayTabId();
  if (!tabId || isScreenOverlay()) return;

  const now = Date.now();
  if (now - lastSlideNavAt < 400) return;
  lastSlideNavAt = now;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      func: (dir) => {
        const isNext = dir === 'next';

        function matchesNav(label) {
          const text = label.toLowerCase();
          if (isNext) {
            if (text.includes('last') || text.includes('end')) return false;
            return (
              text.includes('next slide') ||
              text.includes('go to next') ||
              /\bnext\b/.test(text)
            );
          }
          return (
            text.includes('previous slide') ||
            text.includes('go to previous') ||
            text.includes('prev') ||
            /\bprevious\b/.test(text)
          );
        }

        for (const btn of document.querySelectorAll(
          'button, [role="button"], [data-tooltip], [aria-label]',
        )) {
          const label = [
            btn.getAttribute('aria-label'),
            btn.getAttribute('data-tooltip'),
            btn.getAttribute('title'),
          ]
            .filter(Boolean)
            .join(' ');
          if (label && matchesNav(label)) {
            btn.click();
            return;
          }
        }

        const spec = isNext
          ? { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
          : { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 };
        const init = {
          ...spec,
          which: spec.keyCode,
          bubbles: true,
          cancelable: true,
        };

        function fireInWindow(win) {
          const doc = win.document;
          if (!doc) return false;
          const focusTarget =
            doc.querySelector('.punch-viewer-content, .punch-viewer, [role="main"]') ||
            doc.activeElement ||
            doc.body;
          if (focusTarget?.focus) {
            try {
              focusTarget.focus({ preventScroll: true });
            } catch {
              focusTarget.focus();
            }
          }
          focusTarget?.dispatchEvent(new KeyboardEvent('keydown', init));
          focusTarget?.dispatchEvent(new KeyboardEvent('keyup', init));
          return true;
        }

        if (fireInWindow(window)) return;

        const iframe = document.querySelector(
          'iframe.punch-present-iframe, iframe[src*="presentation"], iframe[src*="punch"]',
        );
        if (iframe?.contentWindow) fireInWindow(iframe.contentWindow);
      },
      args: [direction],
    });
  } catch (err) {
    console.warn('Gesture Canvas: slide navigation failed', err);
  }
}

function routeCompanionMessage(msg) {
  if (!overlayTabId()) return;

  if (msg.type === 'companion-gesture') {
    if (msg.gesture === 'THUMBS_UP' || msg.gesture === 'THUMBS_DOWN') {
      navigatePresentationTab(msg.gesture === 'THUMBS_UP' ? 'next' : 'prev');
    }
    sendOverlayMessage({
      type: 'gesture',
      gesture: msg.gesture,
      nx: msg.nx,
      ny: msg.ny,
      mode: msg.mode,
      tool: msg.tool,
      participantId: msg.participantId,
      pinchSep: msg.pinchSep,
    });
    return;
  }

  if (msg.type === 'companion-mode') {
    if (!isScreenOverlay() && msg.mode !== 'off') {
      sendOverlayMessage({
        type: 'mode',
        mode: msg.mode,
        tool: msg.tool,
      });
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PRESENTER_PORT_NAME) {
    port.postMessage({ type: 'presenter-port-ready' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'companion-gesture') {
        routeCompanionMessage(msg);
        return;
      }
      if (msg.type === 'companion-mode') {
        routeCompanionMessage(msg);
      }
    });
    return;
  }

  if (port.name === TAB_PORT_NAME) {
    tabOverlayPort = port;
    tabOverlayPortTabId = port.sender?.tab?.id ?? null;
    port.postMessage({ type: 'port-connected' });

    port.onDisconnect.addListener(() => {
      if (tabOverlayPort === port) {
        tabOverlayPort = null;
        tabOverlayPortTabId = null;
      }
    });
    return;
  }

  if (port.name !== SCREEN_PORT_NAME) return;

  screenOverlayPort = port;
  port.postMessage({ type: 'port-connected' });

  port.onDisconnect.addListener(() => {
    if (screenOverlayPort === port) screenOverlayPort = null;
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Fire-and-forget — never return true (no reply expected)
  if (msg.type === 'companion-gesture' || msg.type === 'companion-mode') {
    routeCompanionMessage(msg);
    return false;
  }
  if (msg.type === 'camera-grant-complete' || msg.type === 'overlay-reconnected') {
    return false;
  }
  if (msg.type === 'slide-nav') {
    navigatePresentationTab(msg.direction === 'prev' ? 'prev' : 'next');
    return false;
  }

  // Fast sync handlers — reply immediately, no async return
  if (msg.type === 'open-camera-grant') {
    chrome.tabs.create({ url: chrome.runtime.getURL('camera-grant/index.html') });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'open-camera-settings') {
    const site = encodeURIComponent(`chrome-extension://${chrome.runtime.id}/`);
    chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${site}` });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'get-session') {
    sendResponse({
      session,
      relayTabId,
      tabPortConnected: !!tabOverlayPort,
      screenPortConnected: !!screenOverlayPort,
    });
    return false;
  }
  if (msg.type === 'copy-companion-url') {
    sendResponse({
      url: session?.id ? companionUrl(session.id) : companionUrl(null),
    });
    return false;
  }

  let responded = false;
  const reply = (body) => {
    if (!responded) {
      responded = true;
      sendResponse(body);
    }
  };

  (async () => {
    try {
      if (msg.type === 'overlay-ready') {
        if (session && sender.tab?.id === overlayTabId()) {
          await notifyOverlayStart();
        }
        reply({ ok: true });
        return;
      }

      if (msg.type === 'start-session') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab');
        if (session) await endSession();
        reply(await startTabSession(tab.id, msg.name));
        return;
      }

      if (msg.type === 'start-screen-session') {
        if (session) await endSession();
        reply(await startScreenSession(msg.name));
        return;
      }

      if (msg.type === 'end-session') {
        await endSession();
        reply({ ok: true });
        return;
      }

      if (msg.type === 'export-session') {
        await exportSession();
        reply({ ok: true });
        return;
      }

      if (msg.type === 'open-companion') {
        const id = session?.id ?? (await chrome.storage.local.get('gcSession')).gcSession?.id;
        const tabId = overlayTabId() ?? msg.tabId;
        if (id && tabId) {
          await configurePresenterSidePanel(tabId, id);
          await openPresenterSidePanel(tabId);
          reply({ ok: true, url: companionUrl(id) });
        } else {
          reply({ ok: false, error: 'Start a session first' });
        }
        return;
      }

      if (msg.type === 'open-presenter-panel') {
        const tabId = msg.tabId ?? overlayTabId();
        if (session?.id && tabId) {
          await configurePresenterSidePanel(tabId, session.id);
          await openPresenterSidePanel(tabId);
          reply({ ok: true });
        } else {
          reply({ ok: false, error: 'No active session' });
        }
        return;
      }

      reply({ ok: false, error: `Unknown message: ${msg.type}` });
    } catch (err) {
      reply({ error: err.message });
    }
  })();

  return true;
});

loadSession();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  maybeReinjectOnTabNavigation(tabId, tab.url).catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  maybeReinjectOnTabNavigation(details.tabId, details.url).catch(() => {});
});
