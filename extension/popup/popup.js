const $ = (id) => document.getElementById(id);

function showError(msg) {
  const el = $('error');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setUi(active, session) {
  $('idle').classList.toggle('hidden', active);
  $('active').classList.toggle('hidden', !active);
  $('status-dot').classList.toggle('on', active);
  if (session) {
    $('session-id').textContent = session.id;
    $('session-label').textContent = session.name;
    const badge = $('surface-badge');
    const isScreen = session.surface === 'screen';
    badge.textContent = isScreen ? 'Screen / webinar' : 'Tab';
    badge.className = `badge ${isScreen ? 'screen' : 'tab'}`;
    $('screen-steps').classList.toggle('hidden', !isScreen);
    $('tab-steps').classList.toggle('hidden', isScreen);
  }
}

function updateCompanionUrl(sessionId) {
  const local = sessionId
    ? `https://localhost:3000/companion/?session=${sessionId}`
    : 'https://localhost:3000/companion/';
  $('phone-url').textContent = local;
}

updateCompanionUrl(null);

function refresh() {
  chrome.runtime.sendMessage({ type: 'get-session' }, (res) => {
    if (chrome.runtime.lastError) return;
    setUi(!!res.session, res.session);
    if (res.session) updateCompanionUrl(res.session.id);
  });
}

async function openPresenterPanel(tabId, sessionId) {
  if (!tabId || !sessionId) return;
  const path = `sidepanel/index.html?session=${encodeURIComponent(sessionId)}`;
  try {
    await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
    await chrome.sidePanel.open({ tabId });
  } catch {
    /* Side panel may need Chrome 116+ */
  }
}

$('btn-screen').addEventListener('click', async () => {
  showError('');
  const name = $('session-name').value.trim() || 'webinar';
  const res = await chrome.runtime.sendMessage({ type: 'start-screen-session', name });
  if (res?.error) {
    showError(res.error);
    return;
  }
  setUi(true, res.session);
  updateCompanionUrl(res.session.id);
  if (res.presentationTabId) {
    await openPresenterPanel(res.presentationTabId, res.session.id);
  }
});

$('btn-start').addEventListener('click', async () => {
  showError('');
  const name = $('session-name').value.trim();
  const res = await chrome.runtime.sendMessage({ type: 'start-session', name });
  if (res?.error) {
    showError(res.error);
    return;
  }
  setUi(true, res.session);
  updateCompanionUrl(res.session.id);
  const tabId = res.presentationTabId;
  if (tabId) {
    await openPresenterPanel(tabId, res.session.id);
  }
});

$('btn-end').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'end-session' });
  if (res?.error) showError(res.error);
  setUi(false);
  updateCompanionUrl(null);
});

$('btn-export').addEventListener('click', async () => {
  showError('');
  const res = await chrome.runtime.sendMessage({ type: 'export-session' });
  if (res?.error) showError(res.error);
});

$('btn-copy-link').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'copy-companion-url' }, async (res) => {
    if (res?.error) {
      showError(res.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(res.url);
      showError('');
      const btn = $('btn-copy-link');
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    } catch {
      showError('Could not copy — select link from companion page');
    }
  });
});

for (const id of ['btn-companion', 'btn-companion-active']) {
  $(id).addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'get-session' });
    if (res?.session) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = res.session.surface === 'tab' ? res.session.tabId : res.session.overlayTabId;
      await openPresenterPanel(tabId || tab?.id, res.session.id);
    } else {
      showError('Start a session first');
    }
  });
}

refresh();
