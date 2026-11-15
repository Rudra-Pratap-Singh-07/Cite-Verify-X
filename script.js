const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIN_FACE_SCORE = 0.5;

const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const videoPreview = document.getElementById('camera-preview');
const emptyState = document.getElementById('empty-state');
const previewLabel = document.getElementById('preview-label');
const previewHint = document.getElementById('preview-hint');
const consentInput = document.getElementById('camera-consent');
const cameraButton = document.getElementById('camera-button');
const analyzeButton = document.getElementById('analyze-button');
const resetButton = document.getElementById('reset-button');
const retryButton = document.getElementById('retry-button');
const retryModelButton = document.getElementById('retry-model-button');
const modelStatus = document.getElementById('model-status');
const modelStatusText = document.getElementById('model-status-text');
const resultPanel = document.getElementById('result-panel');
const resultKicker = document.getElementById('result-kicker');
const resultMessage = document.getElementById('result-message');
const ageResult = document.getElementById('age-result');
const ageValue = document.getElementById('age-value');

let cameraStream = null;
let imageObjectUrl = null;
let activeSource = null;
let modelsPromise = null;
let modelsReady = false;
let analyzing = false;

function setModelStatus(state, message) {
  modelStatus.className = `model-status ${state}`;
  modelStatusText.textContent = message;
  retryModelButton.hidden = state !== 'error';
}

function updateControls() {
  cameraButton.disabled = !consentInput.checked || cameraButton.dataset.starting === 'true';
  analyzeButton.disabled = !activeSource || analyzing;
}

function clearResult() {
  resultPanel.hidden = true;
  resultPanel.classList.remove('error');
  ageResult.hidden = true;
  retryButton.hidden = true;
  resultMessage.textContent = '';
  ageValue.textContent = '';
}

function showResult(message, { age = null, retry = false, error = false } = {}) {
  resultPanel.hidden = false;
  resultPanel.classList.toggle('error', error || age === null);
  ageResult.hidden = age === null;
  retryButton.hidden = !retry;
  resultKicker.textContent = error ? 'ESTIMATE UNAVAILABLE' : age === null ? 'A QUICK CHECK' : 'A ROUGH ESTIMATE';
  resultMessage.textContent = message;
  if (age !== null) ageValue.textContent = String(age);
}

function releaseImageUrl() {
  if (imageObjectUrl) {
    URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = null;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  videoPreview.pause();
  videoPreview.srcObject = null;
}

function hidePreviewSources() {
  imagePreview.hidden = true;
  videoPreview.hidden = true;
  previewLabel.hidden = true;
  emptyState.hidden = false;
  activeSource = null;
  updateControls();
}

async function loadModels() {
  if (modelsReady) return;
  if (modelsPromise) return modelsPromise;

  setModelStatus('loading', 'Loading face detection and age model…');
  modelsPromise = (async () => {
    if (!window.faceapi) {
      throw new Error('The model runtime did not load. Check your connection and try again.');
    }

    await Promise.all([
      window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      window.faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL)
    ]);
    modelsReady = true;
    setModelStatus('ready', 'On-device model ready');
  })();

  try {
    await modelsPromise;
  } catch (error) {
    modelsPromise = null;
    setModelStatus('error', error instanceof Error ? error.message : 'The model could not be loaded.');
    throw error;
  }
}

function clearActiveInput() {
  stopCamera();
  imagePreview.onload = null;
  imagePreview.onerror = null;
  imagePreview.removeAttribute('src');
  releaseImageUrl();
  imageInput.value = '';
  hidePreviewSources();
  clearResult();
  previewHint.textContent = 'One face works best, with good light.';
}

async function startCamera() {
  if (!consentInput.checked) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showResult('Camera access is not available in this browser. Choose a photo instead.', { error: true });
    return;
  }

  cameraButton.dataset.starting = 'true';
  cameraButton.textContent = 'Requesting camera…';
  updateControls();
  clearActiveInput();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user' }
    });
    videoPreview.srcObject = cameraStream;
    await videoPreview.play();
    videoPreview.hidden = false;
    previewLabel.textContent = 'LIVE CAMERA';
    previewLabel.hidden = false;
    emptyState.hidden = true;
    activeSource = 'camera';
    previewHint.textContent = 'Your camera is on. Choose a clear, well-lit frame.';
    clearResult();
  } catch (error) {
    stopCamera();
    let message = 'Camera could not be started. You can choose a photo instead.';
    if (error && error.name === 'NotAllowedError') {
      message = 'Camera permission was denied. Allow camera access in your browser settings, or choose a photo.';
    } else if (error && error.name === 'NotFoundError') {
      message = 'No camera was found. You can choose a photo instead.';
    } else if (error && error.name === 'NotReadableError') {
      message = 'The camera is already in use by another app. Close it or choose a photo instead.';
    } else if (error && error.name === 'SecurityError') {
      message = 'Camera access requires a secure page (HTTPS or localhost). Choose a photo instead.';
    }
    showResult(message, { error: true });
  } finally {
    delete cameraButton.dataset.starting;
    cameraButton.innerHTML = '<span aria-hidden="true">◎</span> Start camera';
    updateControls();
  }
}

async function loadImage(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    clearActiveInput();
    showResult('That file type is not supported. Choose a JPG, PNG, or WEBP image.', { error: true });
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    clearActiveInput();
    showResult('This image is larger than 15 MB. Choose a smaller image to continue.', { error: true });
    return;
  }

  clearActiveInput();
  imageObjectUrl = URL.createObjectURL(file);
  imagePreview.onload = () => {
    imagePreview.onload = null;
    imagePreview.onerror = null;
    imagePreview.hidden = false;
    emptyState.hidden = true;
    previewLabel.textContent = 'PHOTO PREVIEW';
    previewLabel.hidden = false;
    activeSource = 'image';
    previewHint.textContent = 'Only this image will be checked; it stays on this device.';
    updateControls();
  };
  imagePreview.onerror = () => {
    imagePreview.onload = null;
    imagePreview.onerror = null;
    releaseImageUrl();
    imagePreview.removeAttribute('src');
    hidePreviewSources();
    showResult('This image could not be opened. Try another photo.', { error: true });
  };
  imagePreview.src = imageObjectUrl;
}

async function estimateAge() {
  if (!activeSource || analyzing) return;
  analyzing = true;
  updateControls();
  clearResult();
  previewHint.textContent = 'Checking this frame on your device…';

  try {
    await loadModels();
    const source = activeSource === 'camera' ? videoPreview : imagePreview;
    const detectorOptions = new window.faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: MIN_FACE_SCORE
    });
    const detections = await window.faceapi.detectAllFaces(source, detectorOptions);
    const faces = detections.filter((face) => face.detection.score >= MIN_FACE_SCORE);

    if (faces.length === 0) {
      previewHint.textContent = 'No face found. Try a closer, brighter, front-facing photo.';
      showResult('No face was detected. No age estimate was made.', { error: true });
      return;
    }
    if (faces.length > 1) {
      previewHint.textContent = 'Use a photo with only one clear face.';
      showResult(`We found ${faces.length} faces. For privacy and clarity, this tool estimates one face at a time—choose or crop a single face, then try again.`, { error: true });
      return;
    }

    const result = await window.faceapi
      .detectSingleFace(source, detectorOptions)
      .withAgeAndGender();
    if (!result) {
      previewHint.textContent = 'Try another clear, well-lit photo.';
      showResult('The model could not make a reliable estimate from this image. No age estimate was shown.', { error: true });
      return;
    }

    const estimate = result.age;
    if (!Number.isFinite(estimate) || estimate < 0 || estimate > 100) {
      previewHint.textContent = 'Try another clear, well-lit photo.';
      showResult('The model could not make a reliable estimate from this image. No age estimate was shown.', { error: true });
      return;
    }

    previewHint.textContent = 'This is only a rough visual estimate and may be inaccurate.';
    showResult('The model has made a rough visual guess. It can be inaccurate and should not be used to determine anyone’s actual age.', {
      age: Math.round(estimate),
      retry: activeSource === 'camera'
    });
  } catch (error) {
    const message = modelsReady
      ? 'The image could not be analyzed. Try a different photo or frame.'
      : 'The on-device model could not be loaded, so no age estimate is available. Check your connection and retry.';
    showResult(message, { error: true });
    if (error instanceof Error) console.error('Age estimate unavailable:', error.message);
  } finally {
    analyzing = false;
    updateControls();
  }
}

imageInput.addEventListener('change', (event) => loadImage(event.target.files[0]));
consentInput.addEventListener('change', updateControls);
cameraButton.addEventListener('click', startCamera);
analyzeButton.addEventListener('click', estimateAge);
resetButton.addEventListener('click', clearActiveInput);
retryButton.addEventListener('click', () => {
  clearResult();
  estimateAge();
});
retryModelButton.addEventListener('click', async () => {
  try {
    await loadModels();
  } catch (error) {
    console.error('Could not reload the on-device model:', error);
  }
});

window.addEventListener('pagehide', () => {
  stopCamera();
  releaseImageUrl();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraStream) {
    stopCamera();
    hidePreviewSources();
    clearResult();
    previewHint.textContent = 'Camera paused when you left this tab. Start it again when you are ready.';
  }
});

updateControls();
loadModels().catch((error) => {
  console.error('On-device model unavailable:', error);
});
