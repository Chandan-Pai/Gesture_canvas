/**
 * Gesture Canvas — tab content overlay (minimal UI, gesture-driven ink + laser)
 * Wrapped in IIFE so re-injection via executeScript does not redeclare top-level consts.
 */
(function () {
  const TAB_PORT_NAME = 'tab-overlay';
  const HOST_STYLE =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

  (async () => {
    let createOverlayController;
    let buildToolbar;
    try {
      ({ createOverlayController, buildToolbar } = await import(
        chrome.runtime.getURL('lib/overlay-core.js')
      ));
    } catch (err) {
      console.error('[Gesture Canvas] overlay module failed to load:', err);
      return;
    }

    function stopStackingWatch() {
      if (window.__gcStackInterval) {
        clearInterval(window.__gcStackInterval);
        window.__gcStackInterval = null;
      }
      document.removeEventListener('fullscreenchange', ensureHostOnTop);
      window.removeEventListener('resize', ensureHostOnTop);
    }

    function ensureHostOnTop() {
      const host = document.getElementById('gesture-canvas-host');
      if (!host) return;
      const parent = document.fullscreenElement || document.documentElement;
      if (host.parentNode !== parent) {
        parent.appendChild(host);
      } else if (parent.lastElementChild !== host) {
        parent.appendChild(host);
      }
      host.style.cssText = HOST_STYLE;
      window.__gcCtrl?.resize?.();
    }

    function startStackingWatch() {
      stopStackingWatch();
      document.addEventListener('fullscreenchange', ensureHostOnTop);
      window.addEventListener('resize', ensureHostOnTop);
      ensureHostOnTop();
      if (location.pathname.includes('/present')) {
        window.__gcStackInterval = setInterval(ensureHostOnTop, 800);
      }
    }

    function teardown() {
      stopStackingWatch();
      window.__gcCtrl?.destroy();
      window.__gcCtrl = null;
      document.getElementById('gesture-canvas-host')?.remove();
      try {
        window.__gcPort?.disconnect();
      } catch {
        /* ignore */
      }
      window.__gcPort = null;
    }

    function mount() {
      teardown();

      const host = document.createElement('div');
      host.id = 'gesture-canvas-host';
      host.style.cssText = HOST_STYLE;
      const shadow = host.attachShadow({ mode: 'closed' });

      const root = document.createElement('div');
      root.id = 'gc-root';

      const laserCanvas = document.createElement('canvas');
      laserCanvas.id = 'gc-laser';

      const inkCanvas = document.createElement('canvas');
      inkCanvas.id = 'gc-ink';

      const toolbar = buildToolbar();
      const banner = document.createElement('div');
      banner.id = 'gc-banner';
      banner.textContent = 'Gesture Canvas — share this tab';

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('content/overlay.css');
      shadow.appendChild(link);
      root.append(laserCanvas, inkCanvas, toolbar, banner);
      shadow.appendChild(root);
      document.documentElement.appendChild(host);

      window.__gcCtrl = createOverlayController({
        root,
        laserCanvas,
        inkCanvas,
        toolbar,
        banner,
        bannerText: 'Share this tab in Meet — pointer appears here',
        defaultMode: 'pointer',
        onSlideNavigate: (direction) => {
          chrome.runtime
            .sendMessage({ type: 'slide-nav', direction })
            .catch(() => {});
        },
      });

      window.__gcCtrl.setMode('pointer');
      startStackingWatch();
      connectTabPort();
      return host;
    }

    function connectTabPort() {
      try {
        window.__gcPort?.disconnect();
      } catch {
        /* ignore */
      }
      const port = chrome.runtime.connect({ name: TAB_PORT_NAME });
      window.__gcPort = port;
      port.onMessage.addListener((msg) => handleOverlayMessage(msg));
      port.onDisconnect.addListener(() => {
        if (window.__gcPort === port) window.__gcPort = null;
      });
    }

    function showReconnectedBanner() {
      window.__gcCtrl?.showBanner(true, 'Overlay reconnected — gestures active');
      setTimeout(() => window.__gcCtrl?.showBanner(false), 4000);
    }

    function handleOverlayMessage(msg, sendResponse) {
      if (msg.type === 'session-start') {
        if (!window.__gcCtrl) mount();
        else ensureHostOnTop();
        window.__gcCtrl?.setMode('pointer');
        window.__gcCtrl?.showBanner(true);
        setTimeout(() => window.__gcCtrl?.showBanner(false), 5000);
        sendResponse?.({ ok: true });
        return;
      }

      if (msg.type === 'overlay-reconnected') {
        if (!window.__gcCtrl) mount();
        else {
          ensureHostOnTop();
          if (!window.__gcPort) connectTabPort();
        }
        window.__gcCtrl?.setMode('pointer');
        showReconnectedBanner();
        sendResponse?.({ ok: true });
        return;
      }

      if (msg.type === 'session-end') {
        teardown();
        sendResponse?.({ ok: true });
        return;
      }

      if (msg.type === 'mode') {
        const prev = window.__gcCtrl?.getMode?.();
        if (msg.mode) window.__gcCtrl?.setMode(msg.mode);
        if (msg.tool) window.__gcCtrl?.setTool(msg.tool);
        if (msg.mode && msg.mode !== prev && msg.mode !== 'off') {
          const label = msg.mode === 'write' ? 'Write mode' : 'Pointer mode';
          window.__gcCtrl?.showBanner(true, label);
          setTimeout(() => window.__gcCtrl?.showBanner(false), 1200);
        }
        sendResponse?.({ ok: true });
        return;
      }

      if (msg.type === 'gesture') {
        if (msg.mode && msg.mode !== 'off') window.__gcCtrl?.setMode(msg.mode);
        window.__gcCtrl?.handleGesture(msg);
        sendResponse?.({ ok: true });
        return;
      }

      if (msg.type === 'export-request') {
        if (!window.__gcCtrl) {
          sendResponse?.({ error: 'No overlay' });
          return;
        }
        const payload = { ...window.__gcCtrl.getExportPayload(), compositeDataUrl: null };
        window.__gcPort?.postMessage({ type: 'export-request-result', ...payload });
        sendResponse?.(payload);
        return;
      }
    }

    function signalReady() {
      chrome.runtime.sendMessage({ type: 'overlay-ready' }).catch(() => {});
    }

    if (!window.__gcOverlayListener) {
      window.__gcOverlayListener = true;

      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.type === 'companion-gesture' || msg.type === 'companion-mode') {
          return false;
        }

        if (msg.type === 'overlay-ready') {
          sendResponse({
            ok: !!(document.getElementById('gesture-canvas-host') && window.__gcCtrl),
            mounted: !!window.__gcCtrl,
            port: !!window.__gcPort,
          });
          return;
        }

        handleOverlayMessage(msg, sendResponse);
        return false;
      });
    }

    if (document.getElementById('gesture-canvas-host') && window.__gcCtrl) {
      startStackingWatch();
      if (!window.__gcPort) connectTabPort();
      signalReady();
      return;
    }

    mount();
    signalReady();
  })();
})();
