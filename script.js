// ---------- Configuration & DOM ----------
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const output = document.getElementById('output');
const processedOutput = document.getElementById('processedOutput');
const processingLog = document.getElementById('processingLog');
const logToggle = document.getElementById('logToggle');
const logHeader = document.getElementById('logHeader');
const extractBtn = document.getElementById('extractBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const cameraBtn = document.getElementById('cameraBtn');
const galleryBtn = document.getElementById('galleryBtn');

const API_KEY = 'K88494594188957';
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_DIMENSION = 1400;        // starting cap for longest side (balanced)
const MIN_DIMENSION = 600;         // try not to go below this
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Karnataka plate strict pattern (final form)
const KA_VEHICLE_PATTERN = /^KA\d{2}[A-Z]{1,2}\d{4}$/;

// Global state
let currentFile = null;        // Blob/File used for OCR
let originalBlob = null;       // Original image blob for toggle
let lastPreviewURL = null;     // to revoke object URLs
let autoRunOCR = true;        // automatically run OCR after preprocessing

// ---------- Small utilities & logging ----------
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  processingLog.appendChild(entry);
  processingLog.scrollTop = processingLog.scrollHeight;
}

function clearLog() {
  processingLog.innerHTML = '<div class="log-entry">Ready to process text...</div>';
  processingLog.classList.remove('expanded');
  logToggle.classList.remove('expanded');
}

function isValidImageFile(file) {
  return file && ALLOWED_TYPES.some(t => file.type === t || file.type.startsWith('image/'));
}

function isFileSizeValid(file) {
  return file.size <= MAX_FILE_SIZE;
}

function revokePreview() {
  if (lastPreviewURL) {
    URL.revokeObjectURL(lastPreviewURL);
    lastPreviewURL = null;
  }
}

/**
 * setPreviewFromBlob(blob, label)
 * - shows the blob in your #preview area. If #preview is <img> it sets src, else it injects an <img>.
 */
function setPreviewFromBlob(blob) {
  revokePreview();
  const url = URL.createObjectURL(blob);
  lastPreviewURL = url;

  if (preview.tagName && preview.tagName.toLowerCase() === 'img') {
    preview.src = url;
  } else {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Preview';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '200px';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '6px';
    preview.appendChild(img);
  }
}

// ---------- Image load / render helpers ----------
function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const img = new Image();
    reader.onload = e => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image element'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(fileOrBlob);
  });
}

function renderToCanvas(img, w, h, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Use ctx.filter if available (faster). We'll still support pixel ops for sharpen.
  const filters = [];
  if (opts.grayscale) filters.push('grayscale(100%)');
  if (opts.contrast) filters.push(`contrast(${Math.round(opts.contrast * 100)}%)`);
  ctx.filter = filters.length ? filters.join(' ') : 'none';

  ctx.drawImage(img, 0, 0, w, h);

  // If sharpen or precise contrast needed (or ctx.filter not supported), fall back to pixel ops
  if (opts.sharpen || opts.forcePixelContrast) {
    let imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Manual contrast if requested and filter not used
    if (opts.forcePixelContrast && opts.contrast) {
      for (let i = 0; i < data.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          let v = data[i + ch];
          v = Math.min(255, Math.max(0, (v - 128) * opts.contrast + 128));
          data[i + ch] = v;
        }
      }
    }

    // Sharpen (light kernel)
    if (opts.sharpen) {
      const copy = new Uint8ClampedArray(data);
      const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0, idxk = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const px = ((y + ky) * w + (x + kx)) * 4 + ch;
                sum += copy[px] * kernel[idxk++];
              }
            }
            const out = (y * w + x) * 4 + ch;
            data[out] = Math.min(255, Math.max(0, sum));
          }
          // alpha preserve
          data[(y * w + x) * 4 + 3] = copy[(y * w + x) * 4 + 3];
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // reset filter
  ctx.filter = 'none';
  return canvas;
}

function canvasToBlobPromise(canvas, mime = 'image/jpeg', quality = 0.8) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), mime, quality));
}

// ---------- Preprocessing pipeline (balanced iterative approach) ----------
async function preprocessForOCR(file) {
  addLogEntry('Preprocessing image for OCR...', 'step');

  const img = await loadImage(file);
  const origW = img.width, origH = img.height;

  // initial scale to MAX_DIMENSION
  let scale = Math.min(MAX_DIMENSION / origW, MAX_DIMENSION / origH, 1);
  let targetW = Math.max(Math.round(origW * scale), 1);
  let targetH = Math.max(Math.round(origH * scale), 1);

  // rendering options
  const opts = { grayscale: true, contrast: 1.25, sharpen: true };

  // start quality fairly high; iterative reduce
  let quality = 0.85;
  let blob = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    targetW = Math.max(Math.round(origW * scale), 1);
    targetH = Math.max(Math.round(origH * scale), 1);

    const canvas = renderToCanvas(img, targetW, targetH, opts);
    blob = await canvasToBlobPromise(canvas, 'image/jpeg', quality);

    addLogEntry(`Preprocess attempt ${attempt + 1}: ${targetW}x${targetH}, q=${quality}, size=${Math.round(blob.size/1024)}KB`, 'info');

    if (blob.size <= MAX_FILE_SIZE) break;

    // reduce quality first down to 0.6
    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.1);
      continue;
    }

    // else reduce scale 90% step, but avoid going below MIN_DIMENSION if possible
    const newScale = scale * 0.9;
    const newW = Math.round(origW * newScale);
    const newH = Math.round(origH * newScale);
    if (Math.min(newW, newH) < MIN_DIMENSION) {
      // if quality still > 0.45, drop it; else accept and warn
      if (quality > 0.45) {
        quality = Math.max(0.45, quality - 0.1);
        continue;
      } else {
        addLogEntry('Reached minimal dimension/quality; accepting processed image', 'warning');
        break;
      }
    } else {
      scale = newScale;
      continue;
    }
  }

  if (blob.size > MAX_FILE_SIZE) {
    addLogEntry(`Warning: processed image still >1MB (${Math.round(blob.size/1024)}KB). OCR may reject it.`, 'warning');
  } else {
    addLogEntry(`Processed image ready: ${Math.round(blob.size/1024)}KB`, 'success');
  }

  return blob;
}

// ---------- OCR wrapper (sends currentFile) ----------
async function performOCR() {
  addLogEntry('Uploading image to OCR.Space API...', 'step');
  try {
    const formData = new FormData();
    formData.append('apikey', API_KEY);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');
    formData.append('file', currentFile);

    const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    if (data.IsErroredOnProcessing) {
      const errorMsg = data.ErrorMessage || data.ErrorDetails || 'Unknown error';
      throw new Error(Array.isArray(errorMsg) ? errorMsg.join('; ') : errorMsg);
    }

    const results = data.ParsedResults || [];
    const extractedText = results.map(r => r.ParsedText?.trim()).filter(Boolean).join('\n\n');
    if (extractedText) {
      addLogEntry(`OCR completed. Extracted ${extractedText.length} characters`, 'success');
      return extractedText;
    } else {
      addLogEntry('No text extracted from OCR', 'info');
      return null;
    }
  } catch (err) {
    addLogEntry(`OCR error: ${err.message}`, 'error');
    throw err;
  }
}

// ---------- OCR confusion tolerant helpers ----------
const CONFUSION_MAP = { 'O': '0', '0': 'O', 'I': '1', '1': 'I', 'Z': '2', '2': 'Z', 'S': '5', '5': 'S', 'B':'8', '8':'B' };

/**
 * generateVariants(token, limit)
 * - produces a limited set of token variants by swapping chars using CONFUSION_MAP
 * - caps variants to avoid explosion
 */
function generateVariants(token, limit = 12) {
  const indices = [];
  const chars = token.split('');
  for (let i = 0; i < chars.length; i++) {
    if (CONFUSION_MAP[chars[i]]) indices.push(i);
  }
  if (indices.length === 0) return [token];

  const variants = new Set();
  const maxComb = Math.min(1 << indices.length, 1 << 10); // cap combinations
  for (let mask = 0; mask < maxComb && variants.size < limit; mask++) {
    const arr = chars.slice();
    for (let b = 0; b < indices.length; b++) {
      if (mask & (1 << b)) {
        const idx = indices[b];
        arr[idx] = CONFUSION_MAP[arr[idx]];
      }
    }
    variants.add(arr.join(''));
  }
  return Array.from(variants);
}

// ---------- Plate reconstruction (uses variants for robust matching) ----------
function tryPlateMatchWithVariants(candidate) {
  // quick test if candidate directly matches strict pattern
  if (KA_VEHICLE_PATTERN.test(candidate)) return true;

  // also test some normalized variants (e.g., O->0 etc.)
  const variants = generateVariants(candidate, 20);
  return variants.some(v => KA_VEHICLE_PATTERN.test(v));
}

function findKAVehicleInTokens(tokens) {
  // Try direct tokens and reconstructed candidates.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // direct token or its variants
    if (tryPlateMatchWithVariants(t)) {
      addLogEntry(`Direct plate token/variant match: ${t}`, 'info');
      // prefer normalized variant that matches strict pattern
      const variants = generateVariants(t, 20);
      const good = variants.find(v => KA_VEHICLE_PATTERN.test(v)) || t;
      return { plate: good, indices: [i] };
    }

    // token = "KA##"
    if (/^KA\d{2}$/.test(t)) {
      const district = t;
      for (let j = i + 1; j <= Math.min(i + 4, tokens.length - 1); j++) {
        const tj = tokens[j];
        // letters+4digits
        if (/^[A-Z]{1,2}\d{4}$/.test(tj) || tryPlateMatchWithVariants(district + tj)) {
          const candidate = district + tj;
          addLogEntry(`Trying candidate (district + series+num): ${candidate}`, 'info');
          // check variants
          const variants = generateVariants(candidate, 30);
          const ok = variants.find(v => KA_VEHICLE_PATTERN.test(v));
          if (ok) return { plate: ok, indices: [i, j] };
        }
        // letters only + next token 4 digits
        if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 4, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
          const candidate = district + tj + tokens[j + 1];
          addLogEntry(`Trying candidate (district + letters + digits): ${candidate}`, 'info');
          const variants = generateVariants(candidate, 30);
          const ok = variants.find(v => KA_VEHICLE_PATTERN.test(v));
          if (ok) return { plate: ok, indices: [i, j, j + 1] };
        }
      }
    }

    // token = "KA" followed by "51"
    if (/^KA$/.test(t)) {
      if (i + 1 < tokens.length && /^\d{2}$/.test(tokens[i + 1])) {
        const district = 'KA' + tokens[i + 1];
        for (let j = i + 2; j <= Math.min(i + 5, tokens.length - 1); j++) {
          const tj = tokens[j];
          if (/^[A-Z]{1,2}\d{4}$/.test(tj) || tryPlateMatchWithVariants(district + tj)) {
            const candidate = district + tj;
            addLogEntry(`Trying candidate (KA + digits + series+num): ${candidate}`, 'info');
            const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
            if (ok) return { plate: ok, indices: [i, i + 1, j] };
          }
          if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 5, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
            const candidate = district + tj + tokens[j + 1];
            addLogEntry(`Trying candidate (KA + digits + letters + digits): ${candidate}`, 'info');
            const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
            if (ok) return { plate: ok, indices: [i, i + 1, j, j + 1] };
          }
        }
      }
    }

    // token like "KA51AK" then next "4247"
    if (/^KA\d{2}[A-Z]{1,2}$/.test(t)) {
      if (i + 1 < tokens.length && /^\d{4}$/.test(tokens[i + 1])) {
        const candidate = t + tokens[i + 1];
        addLogEntry(`Trying candidate (KA+letters + digits): ${candidate}`, 'info');
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i, i + 1] };
      }
    }

    // token = "AK4247" and previous tokens contain KA district
    if (/^[A-Z]{1,2}\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^KA\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 1] + t;
        addLogEntry(`Trying candidate (prev KA## + ${t}): ${candidate}`, 'info');
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 1, i] };
      }
      if (i - 2 >= 0 && /^KA$/.test(tokens[i - 2]) && /^\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA + digits + ${t}): ${candidate}`, 'info');
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 2, i - 1, i] };
      }
    }

    // token = "4247" with letters and KA before it
    if (/^\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^[A-Z]{1,2}$/.test(tokens[i - 1]) && i - 2 >= 0 && /^KA\d{2}$/.test(tokens[i - 2])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA## + letters + digits): ${candidate}`, 'info');
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 2, i - 1, i] };
      }
      if (i - 3 >= 0 && /^KA$/.test(tokens[i - 3]) && /^\d{2}$/.test(tokens[i - 2]) && /^[A-Z]{1,2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 3] + tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA + digits + letters + digits): ${candidate}`, 'info');
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 3, i - 2, i - 1, i] };
      }
    }
  }

  return null;
}

// ---------- Text processing (including confusion corrections) ----------
function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');

  // Normalize newlines to spaces to keep token boundaries
  addLogEntry('Step 1: Normalizing newlines', 'step');
  const step1 = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ');
  addLogEntry(`Result: "${step1.substring(0, 80)}${step1.length > 80 ? '...' : ''}"`, 'info');

  // Replace non-alphanumeric with spaces to preserve tokens
  addLogEntry('Step 2: Replacing non-alphanumeric with spaces', 'step');
  const step2 = step1.replace(/[^A-Za-z0-9]/g, ' ');
  addLogEntry(`Result: "${step2.substring(0, 80)}${step2.length > 80 ? '...' : ''}"`, 'info');

  // Uppercase
  addLogEntry('Step 3: Uppercasing', 'step');
  const step3 = step2.toUpperCase();
  addLogEntry(`Result: "${step3.substring(0, 80)}${step3.length > 80 ? '...' : ''}"`, 'info');

  // Tokenize
  addLogEntry('Step 4: Tokenizing', 'step');
  const tokens = step3.split(/\s+/).filter(Boolean);
  addLogEntry(`Tokens: ${tokens.join(', ')}`, 'info');

  // Attempt to find plate (reconstruction + variants)
  addLogEntry('Step 5: Looking for Karnataka vehicle number (reconstructing + variants)...', 'step');
  const found = findKAVehicleInTokens(tokens);

  if (found) {
    addLogEntry(`✓ Found Karnataka vehicle number: ${found.plate}`, 'success');
    return { processed: found.plate, found: true, allMatches: [found.plate], fullProcessed: step3, type: 'vehicle' };
  }

  addLogEntry('✗ No Karnataka vehicle number found', 'warning');
  return { processed: 'No KA vehicle number found', found: false, allMatches: [], fullProcessed: step3, type: 'none' };
}

// ---------- Auto OCR run + UI update flow ----------
async function runOcrAndProcessAndShow() {
  // currentFile must be set (Blob/File)
  if (!currentFile) {
    addLogEntry('No file for OCR', 'warning');
    return;
  }

  try {
    setStatus('Uploading to OCR...');
    output.textContent = 'Uploading to OCR...';
    const ocrText = await performOCR(); // may throw
    if (!ocrText) {
      setStatus('No text detected', true);
      output.textContent = 'No text found in the image.';
      processedOutput.textContent = 'No text to process';
      return;
    }

    // show OCR raw output
    output.textContent = ocrText;
    addLogEntry('Raw OCR text displayed', 'info');

    // process extracted text
    const result = processText(ocrText);
    processedOutput.textContent = result.processed;
    processedOutput.className = `output processed-output ${result.found ? 'found' : 'not-found'}`;
    copyBtn.style.display = result.found ? 'flex' : 'none';

    if (result.found) {
      setStatus(`✓ Found Karnataka vehicle number: ${result.processed}`);
    } else {
      setStatus('⚠ No Karnataka vehicle number pattern found');
    }
  } catch (err) {
    setStatus(`✗ ${err.message}`, true);
    output.textContent = `Error: ${err.message}`;
    processedOutput.textContent = 'Processing failed';
    addLogEntry(`Error during OCR/process: ${err.message}`, 'error');
  }
}

// ---------- File handling pipeline (unified) ----------
async function handleFileInput(file) {
  if (!file) {
    addLogEntry('No file provided', 'warning');
    return;
  }
  addLogEntry(`File chosen: ${file.name} (${Math.round(file.size/1024)}KB)`, 'info');

  if (!isValidImageFile(file)) {
    setStatus('Please select a valid image file (JPG/PNG/GIF)', true);
    addLogEntry('✗ Invalid file type', 'error');
    return;
  }

  // keep a copy of original for "Original/Processed" preview toggle
  originalBlob = file instanceof Blob ? file : new Blob([file], { type: file.type });

  // If file is >1MB, preprocess until under limit
  if (!isFileSizeValid(file)) {
    setStatus('Image >1MB — preprocessing for OCR...');
    try {
      const processedBlob = await preprocessForOCR(file);
      if (processedBlob) {
        // set processed blob as currentFile and show preview
        currentFile = new File([processedBlob], `processed_${file.name.replace(/\s+/g,'_')}.jpg`, { type: 'image/jpeg' });
        setPreviewFromBlob(currentFile);
        addLogEntry(`Using processed image for OCR (${Math.round(currentFile.size/1024)}KB)`, 'success');
        setStatus('Processed image ready (preview shows processed).');
      } else {
        addLogEntry('Preprocess returned null — using original (fallback)', 'warning');
        currentFile = file;
        setPreviewFromBlob(originalBlob);
      }
    } catch (err) {
      addLogEntry(`Preprocess failed: ${err.message}`, 'error');
      currentFile = file;
      setPreviewFromBlob(originalBlob);
      setStatus('Preprocess failed — using original image', true);
    }
  } else {
    // file <=1MB: apply light preprocessing if >200KB (balanced), else use original
    if (file.size > 200 * 1024) {
      addLogEntry('Applying light preprocessing for OCR', 'info');
      try {
        const lightBlob = await preprocessForOCR(file);
        if (lightBlob && lightBlob.size <= MAX_FILE_SIZE) {
          currentFile = new File([lightBlob], `processed_${file.name.replace(/\s+/g,'_')}.jpg`, { type: 'image/jpeg' });
          setPreviewFromBlob(currentFile);
          addLogEntry(`Light preprocess applied (${Math.round(currentFile.size/1024)}KB)`, 'success');
        } else {
          currentFile = file;
          setPreviewFromBlob(originalBlob);
          addLogEntry('Light preprocess produced larger file — using original', 'info');
        }
      } catch (err) {
        addLogEntry(`Light preprocess failed: ${err.message}`, 'warning');
        currentFile = file;
        setPreviewFromBlob(originalBlob);
      }
    } else {
      currentFile = file;
      setPreviewFromBlob(originalBlob);
      addLogEntry('Small file — skipping preprocessing', 'info');
    }
    setStatus('Image ready. Preview shows processed (if applied).');
  }

  // ensure preview toggle exists and shows processed by default
  ensurePreviewToggle();

  // auto-run OCR if configured
  if (autoRunOCR) {
    // slight delay so preview updates first
    setTimeout(() => runOcrAndProcessAndShow(), 300);
  }
}

// ---------- Preview toggle (Original <-> Processed) ----------
let previewToggleBtn = null;
function ensurePreviewToggle() {
  if (previewToggleBtn) return; // already present

  previewToggleBtn = document.createElement('button');
  previewToggleBtn.id = 'previewToggleBtn';
  previewToggleBtn.textContent = 'Show Original';
  previewToggleBtn.title = 'Toggle Original / Processed preview';
  previewToggleBtn.style.marginTop = '8px';
  previewToggleBtn.className = 'btn btn-secondary';

  // Insert toggle just after preview container
  preview.parentNode.insertBefore(previewToggleBtn, preview.nextSibling);

  let showingProcessed = true; // default after preprocess we show processed
  previewToggleBtn.addEventListener('click', () => {
    if (showingProcessed) {
      // show original if available
      if (originalBlob) setPreviewFromBlob(originalBlob);
      previewToggleBtn.textContent = 'Show Processed';
      showingProcessed = false;
    } else {
      // show processed (currentFile)
      if (currentFile) setPreviewFromBlob(currentFile);
      previewToggleBtn.textContent = 'Show Original';
      showingProcessed = true;
    }
  });
}

// ---------- Wiring up existing UI handlers (keeps original behavior) ----------
function openCamera() {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/*';
  tempInput.setAttribute('capture', 'environment');
  tempInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFileInput(e.target.files[0]);
  });
  tempInput.click();
  addLogEntry('Opening camera...', 'info');
}

function openGallery() {
  if (fileInput.hasAttribute('capture')) fileInput.removeAttribute('capture');
  fileInput.click();
  addLogEntry('Opening gallery/storage...', 'info');
}

function setupEventListeners() {
  if (fileInput.hasAttribute('capture')) fileInput.removeAttribute('capture');

  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileInput(file);
  });

  if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
  if (galleryBtn) galleryBtn.addEventListener('click', openGallery);

  dropzone.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    fileInput.click();
  });

  ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', e => { const files = e.dataTransfer.files; if (files.length) handleFileInput(files[0]); });

  clearBtn.addEventListener('click', clearAll);
  extractBtn.addEventListener('click', async () => {
    if (!currentFile) { setStatus('Please select an image first', true); return; }
    // manual trigger: run OCR/process
    await runOcrAndProcessAndShow();
  });

  copyBtn.addEventListener('click', () => {
    const txt = processedOutput.textContent;
    if (txt && txt !== 'Waiting for text extraction...' && txt !== 'No KA vehicle number found') copyToClipboard(txt);
  });

  logHeader.addEventListener('click', () => { processingLog.classList.toggle('expanded'); logToggle.classList.toggle('expanded'); });

  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
}

// ---------- Remaining helpers (copy, clear) ----------
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard!');
    addLogEntry('Copied to clipboard', 'success');
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus('Copy failed', true);
    addLogEntry(`Copy error: ${err}`, 'error');
  }
}

function clearAll() {
  currentFile = null;
  originalBlob = null;
  fileInput.value = '';
  output.textContent = 'Select an image to extract text...';
  processedOutput.textContent = 'Waiting for text extraction...';
  processedOutput.className = 'output processed-output';
  preview.innerHTML = '<div class="preview-placeholder">No image selected</div>';
  clearLog();
  setStatus('');
  copyBtn.style.display = 'none';
  revokePreview();
  if (previewToggleBtn) previewToggleBtn.remove();
  previewToggleBtn = null;
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setStatus('OCR View v0.1 ready to extract KA vehicle numbers');
  clearLog();
  addLogEntry('=== OCR View v0.1 Initialized ===', 'success');
  addLogEntry('Processing log starts closed - click header to expand', 'info');
  addLogEntry('Ready to process images', 'info');
});
