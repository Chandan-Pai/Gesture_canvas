import { attachStream, requestCameraStream, stopCameraStream } from '../lib/camera-access.js';

const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const grantBtn = document.getElementById('btn-grant');
const settingsBtn = document.getElementById('btn-settings');

let stream = null;

function setStatus(text, className = '') {
  statusEl.textContent = text;
  statusEl.className = className;
}

async function grantCamera() {
  grantBtn.disabled = true;
  setStatus('Waiting for Chrome camera prompt — choose Allow…');

  try {
    stream = await requestCameraStream();
    await attachStream(previewEl, stream);
    previewEl.classList.add('visible');
    setStatus('Camera allowed! Returning to the presenter panel…', 'success');
    chrome.runtime.sendMessage({ type: 'camera-grant-complete' }).catch(() => {});
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    grantBtn.disabled = false;
    const name = err?.name || 'Error';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      setStatus('Camera blocked. Open extension settings below and set Camera to Allow, then try again.');
      settingsBtn.classList.remove('hidden');
    } else {
      setStatus(`Camera error: ${name}. Check that a webcam is connected.`);
    }
  }
}

grantBtn.addEventListener('click', grantCamera);

settingsBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-camera-settings' }).catch(() => {});
});

window.addEventListener('beforeunload', () => {
  stopCameraStream(stream, previewEl);
});
