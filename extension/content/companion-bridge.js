/**
 * Bridges gesture messages from localhost companion / relay tabs → extension background.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== 'gesture-canvas') return;

  const type = d.gcType;
  if (type !== 'companion-gesture' && type !== 'companion-mode') return;

  chrome.runtime.sendMessage({ type, ...d.payload }).catch(() => {});
});
