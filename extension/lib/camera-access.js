/** Camera stream + frame loop (avoids MediaPipe CameraUtils alerts on denial). */

export const DEFAULT_CAMERA_CONSTRAINTS = {
  video: { facingMode: 'user', width: 640, height: 480 },
};

export async function queryCameraPermission() {
  if (!navigator.permissions?.query) return 'prompt';
  try {
    const result = await navigator.permissions.query({ name: 'camera' });
    return result.state;
  } catch {
    return 'prompt';
  }
}

export async function requestCameraStream(constraints = DEFAULT_CAMERA_CONSTRAINTS) {
  return navigator.mediaDevices.getUserMedia(constraints);
}

export async function attachStream(videoEl, stream) {
  videoEl.srcObject = stream;
  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play().then(resolve).catch(reject);
    };
    videoEl.onerror = () => reject(new Error('Video failed to load'));
  });
}

export function startFrameLoop(videoEl, onFrame) {
  let lastTime = -1;
  let stopped = false;
  let processing = false;

  const tick = () => {
    if (stopped) return;
    if (!videoEl.paused && videoEl.currentTime !== lastTime) {
      lastTime = videoEl.currentTime;
      if (!processing) {
        processing = true;
        Promise.resolve(onFrame())
          .catch(() => {})
          .finally(() => {
            processing = false;
          });
      }
    }
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}

export function stopCameraStream(stream, videoEl) {
  stream?.getTracks().forEach((track) => track.stop());
  if (videoEl) videoEl.srcObject = null;
}
