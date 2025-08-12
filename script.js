// --------------------------- script.js ---------------------------
// OCR View - Full client-side script
// - Preprocesses images (resize, grayscale, contrast, sharpen)
// - Iteratively compresses to meet 1MB OCR limit
// - Shows processed preview and allows Original <-> Processed toggle
// - Sends to OCR.Space (if API_KEY present) or falls back to Tesseract.js
// - Extracts KA vehicle numbers robustly (split parts, OCR confusions)
// -----------------------------------------------------------------

// ---------- DOM references ----------
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

// ---------- Configuration ----------
const API_KEY = 'K88494594188957'; // If empty, fallback to Tesseract.js
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 1400;        // starting cap for longest side (balanced)
const MIN_DIMENSION = 600;         // don't downscale below this if avoidable
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Karnataka plate strict pattern: KA##A#### or KA##AA####
const KA_VEHICLE_PATTERN = /^KA\d{2}[A-Z]{1,2}\d{4}$/;

// ---------- Global state ----------
let currentFile = null;     // Blob/File used for OCR
let originalBlob = null;    // Keep original for preview toggle
let lastPreviewURL = null;  // to revoke object URLs
let previewToggleBtn = null;
let usingTesseract = false; // filled after dynamic load if needed

// ---------- Utility & Logging ----------
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

// ---------- Image helpers ----------
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
  // opts = { grayscale: bool, contrast: number (1.0 default), sharpen: bool, forcePixelContrast: bool }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const filters = [];
  if (opts.grayscale) filters.push('grayscale(100%)');
  if (opts.contrast && Math.abs(opts.contrast - 1) > 0.01) filters.push(`contrast(${Math.round(opts.contrast * 100)}%)`);
  ctx.filter = filters.length ? filters.join(' ') : 'none';
  ctx.drawImage(img, 0, 0, w, h);

  // Pixel fallback for sharpen or if we need to manually change contrast
  if (opts.sharpen || opts.forcePixelContrast) {
    let imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    if (opts.forcePixelContrast && opts.contrast) {
      for (let i = 0; i < data.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          let v = data[i + ch];
          v = Math.min(255, Math.max(0, (v - 128) * opts.contrast + 128));
          data[i + ch] = v;
        }
      }
    }

    if (opts.sharpen) {
      const copy = new Uint8ClampedArray(data);
      const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      const width = w, height = h;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0;
            let idxk = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const px = ((y + ky) * width + (x + kx)) * 4 + ch;
                sum += copy[px] * kernel[idxk++];
              }
            }
            const out = (y * width + x) * 4 + ch;
            data[out] = Math.min(255, Math.max(0, sum));
          }
          data[(y * width + x) * 4 + 3] = copy[(y * width + x) * 4 + 3];
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  ctx.filter = 'none';
  return canvas;
}

function canvasToBlobPromise(canvas, mime = 'image/jpeg', quality = 0.8) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), mime, quality));
}

// ---------- Preprocess pipeline ----------
async function preprocessForOCR(file) {
  addLogEntry('Preprocessing image for OCR...', 'step');
  const img = await loadImage(file);
  const origW = img.width, origH = img.height;

  let scale = Math.min(MAX_DIMENSION / origW, MAX_DIMENSION / origH, 1);
  let targetW = Math.max(Math.round(origW * scale), 1);
  let targetH = Math.max(Math.round(origH * scale), 1);

  const opts = { grayscale: true, contrast: 1.25, sharpen: true };

  let quality = 0.85;
  let blob = null;

  // iterative attempts
  for (let attempt = 0; attempt < 10; attempt++) {
    targetW = Math.max(Math.round(origW * scale), 1);
    targetH = Math.max(Math.round(origH * scale), 1);

    const canvas = renderToCanvas(img, targetW, targetH, opts);
    blob = await canvasToBlobPromise(canvas, 'image/jpeg', quality);

    addLogEntry(`Preprocess attempt ${attempt + 1}: ${targetW}x${targetH}, q=${quality}, size=${Math.round(blob.size/1024)}KB`, 'info');

    if (blob.size <= MAX_FILE_SIZE) break;

    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.1);
      continue;
    }

    const newScale = scale * 0.9;
    const newW = Math.round(origW * newScale), newH = Math.round(origH * newScale);
    if (Math.min(newW, newH) < MIN_DIMENSION) {
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

// ---------- OCR: OCR.Space (preferred) + Tesseract fallback ----------
async function performOCR_withOCRSpace(blob) {
  addLogEntry('Uploading image to OCR.Space API...', 'step');
  const form = new FormData();
  form.append('apikey', API_KEY);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('scale', 'true');
  form.append('OCREngine', '2');
  form.append('file', blob);

  const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();
  if (data.IsErroredOnProcessing) {
    const errMsg = data.ErrorMessage || data.ErrorDetails || 'Unknown OCR.Space error';
    throw new Error(Array.isArray(errMsg) ? errMsg.join('; ') : errMsg);
  }
  const results = data.ParsedResults || [];
  const extractedText = results.map(r => r.ParsedText?.trim()).filter(Boolean).join('\n\n');
  addLogEntry(`OCR.Space returned ${extractedText ? extractedText.length : 0} chars`, 'info');
  return extractedText || null;
}

function loadTesseractScript() {
  // load Tesseract.js CDN dynamically if not present
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      usingTesseract = true;
      return resolve();
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/tesseract.js@4.1.2/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => {
      usingTesseract = true;
      addLogEntry('Tesseract.js loaded as OCR fallback', 'info');
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
    document.head.appendChild(script);
  });
}

async function performOCR_withTesseract(blob) {
  addLogEntry('Running Tesseract.js OCR locally (fallback)...', 'step');
  // Wait for Tesseract lib loaded
  if (!window.Tesseract) await loadTesseractScript();
  // Tesseract expects either URL or File/Blob. We'll use createObjectURL.
  const url = URL.createObjectURL(blob);
  try {
    const worker = Tesseract.createWorker({
      logger: m => {
        if (m.status) addLogEntry(`Tesseract: ${m.status} ${(m.progress || 0).toFixed(2)}`, 'info');
      }
    });
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const { data } = await worker.recognize(url);
    await worker.terminate();
    URL.revokeObjectURL(url);
    const text = data?.text?.trim() || null;
    addLogEntry(`Tesseract extracted ${text ? text.length : 0} chars`, 'info');
    return text;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function performOCR(blob) {
  // Decide: use OCR.Space if API_KEY provided, else use Tesseract
  if (API_KEY && API_KEY.trim()) {
    try {
      return await performOCR_withOCRSpace(blob);
    } catch (err) {
      addLogEntry(`OCR.Space failed: ${err.message} — falling back to Tesseract`, 'warning');
      await loadTesseractScript();
      return await performOCR_withTesseract(blob);
    }
  } else {
    if (!window.Tesseract) await loadTesseractScript();
    return await performOCR_withTesseract(blob);
  }
}

// ---------- OCR confusion tolerant helpers ----------
const CONFUSION_MAP = { 'O': '0', '0': 'O', 'I': '1', '1': 'I', 'Z': '2', '2': 'Z', 'S': '5', '5': 'S', 'B':'8', '8':'B' };

function generateVariants(token, limit = 12) {
  const indices = [];
  const chars = token.split('');
  for (let i = 0; i < chars.length; i++) {
    if (CONFUSION_MAP[chars[i]]) indices.push(i);
  }
  if (indices.length === 0) return [token];

  const variants = new Set();
  const maxComb = Math.min(1 << indices.length, 1 << 10);
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
function tryPlateMatchWithVariants(candidate) {
  if (KA_VEHICLE_PATTERN.test(candidate)) return true;
  const variants = generateVariants(candidate, 20);
  return variants.some(v => KA_VEHICLE_PATTERN.test(v));
}

// ---------- Plate reconstruction ----------
function findKAVehicleInTokens(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // direct token or variant
    if (tryPlateMatchWithVariants(t)) {
      const variants = generateVariants(t, 20);
      const good = variants.find(v => KA_VEHICLE_PATTERN.test(v)) || t;
      addLogEntry(`Direct token/variant match: ${good}`, 'info');
      return { plate: good, indices: [i] };
    }

    // token = "KA##"
    if (/^KA\d{2}$/.test(t)) {
      const district = t;
      for (let j = i + 1; j <= Math.min(i + 4, tokens.length - 1); j++) {
        const tj = tokens[j];
        if (/^[A-Z]{1,2}\d{4}$/.test(tj) || tryPlateMatchWithVariants(district + tj)) {
          const candidate = district + tj;
          const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
          if (ok) return { plate: ok, indices: [i, j] };
        }
        if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 4, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
          const candidate = district + tj + tokens[j + 1];
          const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
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
            const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
            if (ok) return { plate: ok, indices: [i, i + 1, j] };
          }
          if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 5, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
            const candidate = district + tj + tokens[j + 1];
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
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i, i + 1] };
      }
    }

    // token = series+number and previous tokens contain KA district
    if (/^[A-Z]{1,2}\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^KA\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 1] + t;
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 1, i] };
      }
      if (i - 2 >= 0 && /^KA$/.test(tokens[i - 2]) && /^\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 2, i - 1, i] };
      }
    }

    // token = 4 digits and previous tokens are letters and KA district
    if (/^\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^[A-Z]{1,2}$/.test(tokens[i - 1]) && i - 2 >= 0 && /^KA\d{2}$/.test(tokens[i - 2])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 2, i - 1, i] };
      }
      if (i - 3 >= 0 && /^KA$/.test(tokens[i - 3]) && /^\d{2}$/.test(tokens[i - 2]) && /^[A-Z]{1,2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 3] + tokens[i - 2] + tokens[i - 1] + t;
        const ok = generateVariants(candidate, 30).find(v => KA_VEHICLE_PATTERN.test(v));
        if (ok) return { plate: ok, indices: [i - 3, i - 2, i - 1, i] };
      }
    }
  }
  return null;
}

// ---------- Text processing ----------
function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');

  const step1 = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ');
  addLogEntry('Normalized newlines', 'info');

  const step2 = step1.replace(/[^A-Za-z0-9]/g, ' ');
  addLogEntry('Replaced non-alphanumeric chars with spaces', 'info');

  const step3 = step2.toUpperCase();
  addLogEntry('Converted to uppercase', 'info');

  const tokens = step3.split(/\s+/).filter(Boolean);
  addLogEntry(`Tokens: ${tokens.slice(0,50).join(', ')}${tokens.length>50 ? '...' : ''}`, 'info');

  const found = findKAVehicleInTokens(tokens);
  if (found) {
    addLogEntry(`✓ Found Karnataka vehicle number: ${found.plate}`, 'success');
    return { processed: found.plate, found: true, allMatches: [found.plate], fullProcessed: step3, type: 'vehicle' };
  }

  addLogEntry('✗ No Karnataka vehicle number found', 'warning');
  return { processed: 'No KA vehicle number found', found: false, allMatches: [], fullProcessed: step3, type: 'none' };
}

// ---------- Orchestrator: run OCR -> process -> show ----------
async function runOcrAndProcessAndShow() {
  if (!currentFile) { addLogEntry('No file to OCR', 'warning'); setStatus('Please select an image first', true); return; }

  try {
    setStatus('Uploading to OCR...');
    output.textContent = 'Uploading to OCR...';
    const ocrText = await performOCR(currentFile);
    if (!ocrText) {
      setStatus('No text detected', true);
      output.textContent = 'No text found in the image.';
      processedOutput.textContent = 'No text to process';
      return;
    }
    output.textContent = ocrText;
    addLogEntry('Raw OCR text displayed', 'info');

    const result = processText(ocrText);
    processedOutput.textContent = result.processed;
    processedOutput.className = `output processed-output ${result.found ? 'found' : 'not-found'}`;
    copyBtn.style.display = result.found ? 'flex' : 'none';
    setStatus(result.found ? `✓ Found Karnataka vehicle number: ${result.processed}` : '⚠ No Karnataka vehicle number pattern found');
  } catch (err) {
    addLogEntry(`OCR/process error: ${err.message}`, 'error');
    setStatus(`✗ ${err.message}`, true);
    output.textContent = `Error: ${err.message}`;
    processedOutput.textContent = 'Processing failed';
  }
}

// ---------- File pipeline (unified) ----------
async function handleFileInput(file) {
  if (!file) { addLogEntry('No file provided', 'warning'); return; }
  addLogEntry(`File chosen: ${file.name} (${Math.round(file.size/1024)}KB)`, 'info');

  if (!isValidImageFile(file)) {
    setStatus('Please select a valid image file (JPG/PNG/GIF)', true);
    addLogEntry('✗ Invalid file type', 'error');
    return;
  }

  originalBlob = file instanceof Blob ? file : new Blob([file], { type: file.type });

  // If too large => preprocess until under limit
  if (!isFileSizeValid(file)) {
    setStatus('Image >1MB — preprocessing...');
    try {
      const processedBlob = await preprocessForOCR(file);
      if (processedBlob) {
        currentFile = new File([processedBlob], `processed_${file.name.replace(/\s+/g,'_')}.jpg`, { type: 'image/jpeg' });
        setPreviewFromBlob(currentFile);
        addLogEntry(`Using processed image for OCR (${Math.round(currentFile.size/1024)}KB)`, 'success');
        setStatus('Processed image ready (preview shows processed).');
      } else {
        addLogEntry('Preprocess returned null — using original', 'warning');
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
    // file <=1MB: apply light preprocess if >200KB
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

  ensurePreviewToggle();
  // Auto-run OCR (short delay allows preview to render)
  setTimeout(() => runOcrAndProcessAndShow(), 300);
}

// ---------- Preview toggle ----------
function ensurePreviewToggle() {
  if (previewToggleBtn) return;
  previewToggleBtn = document.createElement('button');
  previewToggleBtn.id = 'previewToggleBtn';
  previewToggleBtn.textContent = 'Show Original';
  previewToggleBtn.title = 'Toggle Original / Processed preview';
  previewToggleBtn.style.marginTop = '8px';
  previewToggleBtn.className = 'btn btn-secondary';
  preview.parentNode.insertBefore(previewToggleBtn, preview.nextSibling);

  let showingProcessed = true;
  previewToggleBtn.addEventListener('click', () => {
    if (showingProcessed) {
      if (originalBlob) setPreviewFromBlob(originalBlob);
      previewToggleBtn.textContent = 'Show Processed';
      showingProcessed = false;
    } else {
      if (currentFile) setPreviewFromBlob(currentFile);
      previewToggleBtn.textContent = 'Show Original';
      showingProcessed = true;
    }
  });
}

// ---------- File input & UI event wiring ----------
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

  dropzone.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fileInput.click(); });

  ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', e => { const files = e.dataTransfer.files; if (files.length) handleFileInput(files[0]); });

  clearBtn.addEventListener('click', clearAll);
  extractBtn.addEventListener('click', async () => {
    if (!currentFile) { setStatus('Please select an image first', true); return; }
    await runOcrAndProcessAndShow();
  });

  copyBtn.addEventListener('click', () => {
    const txt = processedOutput.textContent;
    if (txt && txt !== 'Waiting for text extraction...' && txt !== 'No KA vehicle number found') copyToClipboard(txt);
  });

  logHeader.addEventListener('click', () => { processingLog.classList.toggle('expanded'); logToggle.classList.toggle('expanded'); });

  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
}

// ---------- Misc helpers ----------
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
  if (previewToggleBtn) { previewToggleBtn.remove(); previewToggleBtn = null; }
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
