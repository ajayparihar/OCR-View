// script.js - Full merged, readable, commented JavaScript
// - Unified pipeline for camera/gallery/PC
// - Balanced preprocessing (resize, grayscale, contrast, sharpen) until under 1MB
// - Smart compression: quality vs size vs OCR accuracy optimization
// - Preview processed image, toggle Original <-> Processed
// - OCR via OCR.Space (preferred) with Tesseract.js fallback
// - Runs OCR on both Processed and Original and merges results for higher recall
// - Robust KA vehicle extraction with OCR-confusion tolerant variants
// - Clean structure and logs

// ---------- DOM references (must match your HTML) ----------
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
const API_KEY = 'K88494594188957'; // OCR.Space key; if empty, fallback to Tesseract only
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 1400;        // More balanced starting cap for longest side
const MIN_DIMENSION = 600;         // Higher lower bound for better OCR accuracy
const LIGHT_PREPROCESS_THRESHOLD = 300 * 1024; // Only preprocess files >300KB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Karnataka plate strict pattern: KA##A#### or KA##AA####
const KA_VEHICLE_PATTERN = /^KA\d{2}[A-Z]{1,2}\d{4}$/;

// ---------- Global state ----------
let currentFile = null;     // Blob/File used by OCR (processed preferred)
let originalBlob = null;    // Original image blob for toggle / fallback
let lastPreviewURL = null;  // for revoking object URLs
let previewToggleBtn = null;

// ---------- Logging & small helpers ----------
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
    img.style.borderRadius = '8px';
    preview.appendChild(img);
  }
}

// ---------- Image loading & canvas rendering ----------
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

function renderToCanvas(img, width, height, opts = {}) {
  // opts = { grayscale: bool, contrast: number, sharpen: bool, forcePixelContrast: bool }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Use CSS filters if available (fast). We'll fallback to pixel ops for sharpen or precise contrast.
  const filters = [];
  if (opts.grayscale) filters.push('grayscale(100%)');
  if (opts.contrast && Math.abs(opts.contrast - 1) > 0.01) filters.push(`contrast(${Math.round(opts.contrast * 100)}%)`);
  ctx.filter = filters.length ? filters.join(' ') : 'none';

  ctx.drawImage(img, 0, 0, width, height);

  // Pixel ops fallback for sharpen or manual contrast
  if (opts.sharpen || opts.forcePixelContrast) {
    let imageData = ctx.getImageData(0, 0, width, height);
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
      const w = width, h = height;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0;
            let kIdx = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const px = ((y + ky) * w + (x + kx)) * 4 + ch;
                sum += copy[px] * kernel[kIdx++];
              }
            }
            const out = (y * w + x) * 4 + ch;
            data[out] = Math.min(255, Math.max(0, sum));
          }
          // alpha
          data[(y * w + x) * 4 + 3] = copy[(y * w + x) * 4 + 3];
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

// ---------- Preprocessing: balanced iterative compression until under limit ----------
async function preprocessForOCR(file) {
  addLogEntry('Preprocessing image for OCR...', 'step');

  const img = await loadImage(file);
  const origW = img.width, origH = img.height;

  // Calculate optimal starting dimensions - balance between quality and size
  let scale = Math.min(MAX_DIMENSION / origW, MAX_DIMENSION / origH, 1);
  
  // Ensure we don't go below MIN_DIMENSION for OCR accuracy
  if (scale * Math.min(origW, origH) < MIN_DIMENSION) {
    scale = MIN_DIMENSION / Math.min(origW, origH);
  }
  
  let targetW = Math.max(Math.round(origW * scale), 1);
  let targetH = Math.max(Math.round(origH * scale), 1);

  // OCR-optimized processing options - balanced for clarity without over-processing
  const opts = { grayscale: true, contrast: 1.25, sharpen: true };

  // Start with high quality and reduce more gradually
  let quality = 0.92;
  let blob = null;
  let attempts = 0;
  const maxAttempts = 8; // Reduced from 12 for better balance

  // Track the best result so far
  let bestBlob = null;
  let bestScore = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    targetW = Math.max(Math.round(origW * scale), 1);
    targetH = Math.max(Math.round(origH * scale), 1);

    const canvas = renderToCanvas(img, targetW, targetH, opts);
    blob = await canvasToBlobPromise(canvas, 'image/jpeg', quality);

    // Calculate a quality score (higher is better)
    const sizeScore = Math.max(0, 1 - (blob.size / MAX_FILE_SIZE));
    const dimensionScore = Math.min(1, (targetW * targetH) / (origW * origH));
    const qualityScore = quality;
    const overallScore = (sizeScore * 0.4) + (dimensionScore * 0.4) + (qualityScore * 0.2);

    addLogEntry(`Attempt ${attempts}: ${targetW}x${targetH}, q=${quality.toFixed(2)}, size=${Math.round(blob.size/1024)}KB, score=${overallScore.toFixed(3)}`, 'info');

    // Keep track of the best result
    if (overallScore > bestScore) {
      bestScore = overallScore;
      bestBlob = blob;
    }

    // If we're under the size limit, we can stop
    if (blob.size <= MAX_FILE_SIZE) {
      addLogEntry(`✓ Target size achieved: ${Math.round(blob.size/1024)}KB`, 'success');
      break;
    }

    // Smart progression: balance quality vs dimension reduction
    if (attempt < 3) {
      // First 3 attempts: reduce quality gradually
      quality = Math.max(0.75, quality - 0.05);
    } else if (attempt < 5) {
      // Next 2 attempts: reduce quality more aggressively
      quality = Math.max(0.65, quality - 0.08);
    } else {
      // Final attempts: reduce both quality and dimensions
      quality = Math.max(0.55, quality - 0.1);
      
      // Only reduce dimensions if quality is already low
      if (quality <= 0.65) {
        const newScale = scale * 0.95; // More gradual scaling
        const newW = Math.round(origW * newScale);
        const newH = Math.round(origH * newScale);
        
        // Ensure we don't go below minimum dimensions
        if (Math.min(newW, newH) >= MIN_DIMENSION) {
          scale = newScale;
        } else {
          // If we can't scale down more, try one last quality drop
          if (quality > 0.5) {
            quality = Math.max(0.5, quality - 0.15);
          } else {
            addLogEntry('Reached minimum quality/dimension limits', 'warning');
            break;
          }
        }
      }
    }
  }

  // Use the best result we found, or the last one if none were under limit
  const finalBlob = bestBlob || blob;
  
  // Calculate compression ratio and provide balanced feedback
  const compressionRatio = (finalBlob.size / file.size) * 100;
  const dimensionRatio = ((targetW * targetH) / (origW * origH)) * 100;
  
  if (finalBlob.size > MAX_FILE_SIZE) {
    addLogEntry(`⚠ Warning: Best processed image still >1MB (${Math.round(finalBlob.size/1024)}KB). OCR may reject it.`, 'warning');
    addLogEntry(`Best score achieved: ${bestScore.toFixed(3)}`, 'info');
  } else {
    addLogEntry(`✓ Processed image ready: ${Math.round(finalBlob.size/1024)}KB`, 'success');
  }
  
  // Log compression balance information
  addLogEntry(`Compression: ${compressionRatio.toFixed(1)}% of original size, ${dimensionRatio.toFixed(1)}% of original pixels`, 'info');
  addLogEntry(`Final quality: ${quality.toFixed(2)}, dimensions: ${targetW}x${targetH}`, 'info');

  return finalBlob;
}

// ---------- OCR handling: OCR.Space preferred, Tesseract fallback ----------
// OCR.Space call
async function performOCR_space(blob) {
  addLogEntry('Uploading image to OCR.Space...', 'step');
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

// Dynamic load Tesseract.js (fallback)
function loadTesseractScript() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/tesseract.js@4.1.2/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
    document.head.appendChild(script);
  });
}

async function performOCR_tesseract(blob) {
  addLogEntry('Running Tesseract.js OCR locally...', 'step');
  if (!window.Tesseract) await loadTesseractScript();

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

// Wrapper: prefer OCR.Space, fallback to Tesseract
async function performOCR_single(blob) {
  if (API_KEY && API_KEY.trim()) {
    try {
      return await performOCR_space(blob);
    } catch (err) {
      addLogEntry(`OCR.Space failed: ${err.message} — falling back to Tesseract`, 'warning');
      return await performOCR_tesseract(blob);
    }
  } else {
    // no API key: use Tesseract
    return await performOCR_tesseract(blob);
  }
}

// ---------- Dual OCR: run on processed + original and merge results ----------
async function performOCR_both(processedBlob, originalBlob) {
  // Run OCR on processed first (faster, likely better)
  addLogEntry('Starting OCR on processed image', 'step');
  let processedText = null;
  try {
    processedText = await performOCR_single(processedBlob);
  } catch (err) {
    addLogEntry(`Processed OCR failed: ${err.message}`, 'error');
    processedText = null;
  }

  // Run OCR on original as fallback or to merge
  addLogEntry('Starting OCR on original image', 'step');
  let originalText = null;
  try {
    originalText = await performOCR_single(originalBlob);
  } catch (err) {
    addLogEntry(`Original OCR failed: ${err.message}`, 'warning');
    originalText = null;
  }

  // Merge results: prefer processed text lines, add originals that are new
  const pieces = [];
  if (processedText) pieces.push(processedText);
  if (originalText && originalText !== processedText) pieces.push(originalText);

  const combined = pieces.join('\n\n').trim() || null;
  addLogEntry(`Combined OCR length: ${combined ? combined.length : 0}`, 'info');
  return combined;
}

// ---------- OCR confusion correction helpers ----------
const CONFUSION_MAP = { 'O': '0', '0': 'O', 'I': '1', '1': 'I', 'Z': '2', '2': 'Z', 'S': '5', '5': 'S', 'B': '8', '8': 'B' };

function generateVariants(token, limit = 12) {
  const indices = [];
  const chars = token.split('');
  for (let i = 0; i < chars.length; i++) if (CONFUSION_MAP[chars[i]]) indices.push(i);
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

// ---------- Plate reconstruction & robust matching ----------
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

// ---------- Text processing & orchestrator ----------
function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');

  const step1 = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ');
  const step2 = step1.replace(/[^A-Za-z0-9]/g, ' ');
  const step3 = step2.toUpperCase();
  addLogEntry('Normalized and tokenized text', 'info');

  const tokens = step3.split(/\s+/).filter(Boolean);
  addLogEntry(`Tokens (sample): ${tokens.slice(0,40).join(', ')}${tokens.length > 40 ? '...' : ''}`, 'info');

  const found = findKAVehicleInTokens(tokens);
  if (found) {
    addLogEntry(`✓ Found Karnataka vehicle number: ${found.plate}`, 'success');
    return { processed: found.plate, found: true, allMatches: [found.plate], fullProcessed: step3, type: 'vehicle' };
  }

  addLogEntry('✗ No Karnataka vehicle number found', 'warning');
  return { processed: 'No KA vehicle number found', found: false, allMatches: [], fullProcessed: step3, type: 'none' };
}

// ---------- Orchestration: run OCR on processed & original, merge, show ----------
async function orchestrateOCRandExtraction() {
  if (!currentFile || !originalBlob) {
    addLogEntry('No image available for OCR', 'warning');
    setStatus('Please select an image first', true);
    return;
  }

  try {
    setStatus('Running OCR on processed + original images...');
    output.textContent = 'Running OCR...';
    // Run OCR on both and merge results
    const combinedText = await performOCR_both(currentFile, originalBlob);
    if (!combinedText) {
      setStatus('No text detected', true);
      output.textContent = 'No text found in the image.';
      processedOutput.textContent = 'No text to process';
      addLogEntry('No text extracted from either image', 'warning');
      return;
    }

    // display raw merged OCR text
    output.textContent = combinedText;
    addLogEntry('Displayed merged OCR text', 'info');

    // process text to find plate
    const result = processText(combinedText);
    processedOutput.textContent = result.processed;
    processedOutput.className = `output processed-output ${result.found ? 'found' : 'not-found'}`;
    copyBtn.style.display = result.found ? 'flex' : 'none';
    setStatus(result.found ? `✓ Found Karnataka vehicle number: ${result.processed}` : '⚠ No Karnataka vehicle number pattern found');
  } catch (err) {
    addLogEntry(`OCR/Processing error: ${err.message}`, 'error');
    setStatus(`✗ ${err.message}`, true);
    output.textContent = `Error: ${err.message}`;
    processedOutput.textContent = 'Processing failed';
  }
}

// ---------- Unified file handling pipeline ----------
async function handleFileInput(file) {
  if (!file) { addLogEntry('No file provided', 'warning'); return; }
  addLogEntry(`File chosen: ${file.name} (${Math.round(file.size/1024)}KB)`, 'info');

  if (!isValidImageFile(file)) {
    setStatus('Please select a valid image file (JPG/PNG/GIF)', true);
    addLogEntry('✗ Invalid file type', 'error');
    return;
  }

  originalBlob = file instanceof Blob ? file : new Blob([file], { type: file.type });

  // If >1MB, preprocess until under limit
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
    // <=1MB: apply light preprocess for OCR accuracy if above threshold
    if (file.size > LIGHT_PREPROCESS_THRESHOLD) {
      addLogEntry('Applying light preprocessing for OCR accuracy', 'info');
      try {
        // Use a more conservative preprocessing approach for smaller files
        const img = await loadImage(file);
        const origW = img.width, origH = img.height;
        
        // Only resize if significantly larger than optimal
        let targetW = origW, targetH = origH;
        if (Math.max(origW, origH) > 1200) {
          const scale = 1200 / Math.max(origW, origH);
          targetW = Math.round(origW * scale);
          targetH = Math.round(origH * scale);
        }
        
        // Light OCR optimization without aggressive compression
        const opts = { grayscale: true, contrast: 1.15, sharpen: false };
        const canvas = renderToCanvas(img, targetW, targetH, opts);
        const lightBlob = await canvasToBlobPromise(canvas, 'image/jpeg', 0.85);
        
        if (lightBlob && lightBlob.size <= file.size * 0.9) { // Only use if significantly smaller
          currentFile = new File([lightBlob], `processed_${file.name.replace(/\s+/g,'_')}.jpg`, { type: 'image/jpeg' });
          setPreviewFromBlob(currentFile);
          const compressionRatio = (lightBlob.size / file.size) * 100;
          const dimensionRatio = ((targetW * targetH) / (origW * origH)) * 100;
          addLogEntry(`Light preprocess applied: ${Math.round(origW)}x${origH} → ${targetW}x${targetH}`, 'success');
          addLogEntry(`Size: ${Math.round(file.size/1024)}KB → ${Math.round(currentFile.size/1024)}KB (${compressionRatio.toFixed(1)}%)`, 'success');
          addLogEntry(`Pixels: ${dimensionRatio.toFixed(1)}% of original, quality: 0.85`, 'info');
        } else {
          currentFile = file;
          setPreviewFromBlob(originalBlob);
          addLogEntry('Light preprocess not beneficial — using original', 'info');
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

  // Auto-run OCR on both (short delay so preview updates)
  setTimeout(() => orchestrateOCRandExtraction(), 300);
}

// ---------- Preview toggle (Original <-> Processed) ----------
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

// ---------- Event wiring (camera/gallery/file/drop) ----------
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
    if (!currentFile || !originalBlob) { setStatus('Please select an image first', true); return; }
    await orchestrateOCRandExtraction();
  });

  copyBtn.addEventListener('click', () => {
    const txt = processedOutput.textContent;
    if (txt && txt !== 'Waiting for text extraction...' && txt !== 'No KA vehicle number found') copyToClipboard(txt);
  });

  logHeader.addEventListener('click', () => { processingLog.classList.toggle('expanded'); logToggle.classList.toggle('expanded'); });

  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
}

// ---------- Copy / clear helpers ----------
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
  setStatus('OCR View ready');
  clearLog();
  addLogEntry('=== OCR View Initialized ===', 'success');
  addLogEntry('Processing log starts closed - click header to expand', 'info');
  addLogEntry('Ready to process images', 'info');
});
