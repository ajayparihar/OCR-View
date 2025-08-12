// ---------- Configuration & DOM ----------

// DOM Elements (keeps your original IDs)
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

// Settings
const API_KEY = 'K88494594188957';
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 1400; // starting cap for longest side (balanced)
const MIN_DIMENSION = 600; // don't downscale below this if avoidable
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Strict Karnataka vehicle number final pattern: KA##A#### or KA##AA####
const KA_VEHICLE_PATTERN = /^KA\d{2}[A-Z]{1,2}\d{4}$/;

// Global state
let currentFile = null;            // Blob/File currently used for OCR (processed)
let lastPreviewURL = null;         // to revoke object URLs and avoid leaks

// ---------- Small utilities & logging ----------

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function isValidImageFile(file) {
  return file && ALLOWED_TYPES.some(type => file.type === type || file.type.startsWith('image/'));
}

function isFileSizeValid(file) {
  return file.size <= MAX_FILE_SIZE;
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

// Cleanup previous preview URL if any
function setPreviewFromBlob(blob) {
  if (lastPreviewURL) {
    URL.revokeObjectURL(lastPreviewURL);
    lastPreviewURL = null;
  }
  const url = URL.createObjectURL(blob);
  lastPreviewURL = url;
  // If preview element is an <img>
  if (preview.tagName && preview.tagName.toLowerCase() === 'img') {
    preview.src = url;
  } else {
    // If preview is a div, place an image inside
    preview.innerHTML = '';
    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.alt = 'Processed preview';
    imgEl.style.maxWidth = '100%';
    imgEl.style.maxHeight = '200px';
    imgEl.style.objectFit = 'contain';
    imgEl.style.borderRadius = '8px';
    preview.appendChild(imgEl);
  }
}

// ---------- Image preprocessing pipeline ----------

/**
 * loadImage(fileOrBlob) -> HTMLImageElement
 * - creates an Image from a File/Blob via FileReader
 */
function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const img = new Image();
    reader.onload = (e) => {
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(new Error('Image load error'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(fileOrBlob);
  });
}

/**
 * renderToCanvas(img, targetWidth, targetHeight, options)
 * - draws the image on a canvas with optional ctx.filter usage
 * - returns the canvas element
 * options: { grayscale(true/false), contrast (1.0=normal), sharpen(boolean) }
 */
function renderToCanvas(img, targetWidth, targetHeight, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  // Use CSS-like filter if supported (faster). We still do pixel fallback if needed.
  let filters = [];
  if (options.grayscale) filters.push('grayscale(100%)');
  if (options.contrast && options.contrast !== 1) filters.push(`contrast(${Math.round(options.contrast * 100)}%)`);
  if (filters.length) {
    ctx.filter = filters.join(' ');
  } else {
    ctx.filter = 'none';
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // If we want to apply sharpen or a precise contrast adjustment, manipulate pixels
  if (options.sharpen || (options.contrast && Math.abs(options.contrast - 1) > 0.05 && !('filter' in ctx))) {
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // If filter wasn't used for contrast, apply contrast manually
    if (!('filter' in ctx) && options.contrast && Math.abs(options.contrast - 1) > 0.01) {
      const c = options.contrast;
      // contrast formula on [0..255] values: factor = (259*(c+255)) / (255*(259-c))
      // where c is contrast in range [-255..255]; but our c here is multiplier -> convert
      // we'll use a simple multiplier around avg: new = (value - 128) * c + 128
      for (let i = 0; i < data.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          let v = data[i + ch];
          v = Math.min(255, Math.max(0, (v - 128) * options.contrast + 128));
          data[i + ch] = v;
        }
      }
    }

    // Optional sharpen kernel (light)
    if (options.sharpen) {
      const w = canvas.width, h = canvas.height;
      const copy = new Uint8ClampedArray(data); // snapshot
      const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]; // light sharpen
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0;
            let idxk = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const px = ((y + ky) * w + (x + kx)) * 4 + ch;
                sum += copy[px] * kernel[idxk++];
              }
            }
            const outIdx = (y * w + x) * 4 + ch;
            data[outIdx] = Math.min(255, Math.max(0, sum));
          }
          // preserve alpha
          data[(y * w + x) * 4 + 3] = copy[(y * w + x) * 4 + 3];
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // Reset ctx.filter
  ctx.filter = 'none';
  return canvas;
}

/**
 * canvasToBlobPromise(canvas, mime, quality)
 */
function canvasToBlobPromise(canvas, mime = 'image/jpeg', quality = 0.8) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mime, quality);
  });
}

/**
 * preprocessForOCR(file)
 * - balanced strategy:
 *   1. load image
 *   2. start with MAX_DIMENSION and quality ~0.85
 *   3. render grayscale + contrast + light sharpen
 *   4. if blob > MAX_FILE_SIZE reduce quality first (to 0.6), then reduce size (scale down stepwise)
 *   5. return Blob ready for OCR (and used for preview)
 */
async function preprocessForOCR(file) {
  addLogEntry('Preprocessing image for OCR...', 'step');
  const img = await loadImage(file);

  // Determine initial scale to fit MAX_DIMENSION
  const origW = img.width;
  const origH = img.height;
  let scale = Math.min(MAX_DIMENSION / origW, MAX_DIMENSION / origH, 1);
  let targetW = Math.max(Math.round(origW * scale), 1);
  let targetH = Math.max(Math.round(origH * scale), 1);

  // Options for rendering (balanced)
  const options = {
    grayscale: true,
    contrast: 1.25,    // slight contrast boost
    sharpen: true      // light sharpening to make edges crisper
  };

  // Start with high-ish quality and conservative dimension reduction
  let quality = 0.85;
  let blob = null;

  // Try iterative approach:
  //  - try rendering with current scale & quality
  //  - if blob > MAX_FILE_SIZE, reduce quality down to 0.6
  //  - if still too big, reduce scale (90% each step) until acceptable or until MIN_DIMENSION reached
  for (let attempt = 0; attempt < 8; attempt++) {
    targetW = Math.max(Math.round(origW * scale), 1);
    targetH = Math.max(Math.round(origH * scale), 1);

    const canvas = renderToCanvas(img, targetW, targetH, options);
    blob = await canvasToBlobPromise(canvas, 'image/jpeg', quality);

    addLogEntry(`Preprocess attempt ${attempt + 1}: dims=${targetW}x${targetH} q=${quality} size=${Math.round(blob.size / 1024)}KB`, 'info');

    // If already under limit, break
    if (blob.size <= MAX_FILE_SIZE) break;

    // Reduce quality first (down to 0.6)
    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.1);
      continue;
    }

    // Then reduce scale gradually (not below MIN_DIMENSION if possible)
    const newScale = scale * 0.9;
    // If reducing would go below MIN_DIMENSION, clamp; otherwise accept new scale
    if (Math.min(Math.round(origW * newScale), Math.round(origH * newScale)) < MIN_DIMENSION) {
      // If already below MIN_DIMENSION, do a final aggressive quality drop
      if (quality > 0.45) {
        quality = Math.max(0.45, quality - 0.1);
        continue;
      } else {
        // last resort: accept whatever we have (can't do more without severe loss)
        addLogEntry('Reached minimal dimension/quality; accepting processed image', 'warning');
        break;
      }
    } else {
      scale = newScale;
      continue;
    }
  }

  // Final check: if still > MAX_FILE_SIZE, log warning but return blob (we attempted)
  if (blob.size > MAX_FILE_SIZE) {
    addLogEntry(`Warning: processed image still >1MB (${Math.round(blob.size / 1024)}KB). OCR may reject it.`, 'warning');
  } else {
    addLogEntry(`Processed image ready: ${Math.round(blob.size / 1024)}KB`, 'success');
  }

  return blob;
}

// ---------- Vehicle plate reconstruction & text logic (kept and cleaned) ----------

/**
 * findKAVehicleInTokens(tokens)
 * - tries many safe reconstruction patterns to avoid false positives
 * - unchanged logic but kept clean and logged
 */
function findKAVehicleInTokens(tokens) {
  const plateRegex = KA_VEHICLE_PATTERN;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // direct full token match
    if (plateRegex.test(t)) {
      addLogEntry(`Direct plate token match: ${t}`, 'info');
      return { plate: t, indices: [i] };
    }

    // token = "KA##"
    if (/^KA\d{2}$/.test(t)) {
      const district = t;
      for (let j = i + 1; j <= Math.min(i + 4, tokens.length - 1); j++) {
        const tj = tokens[j];
        if (/^[A-Z]{1,2}\d{4}$/.test(tj)) {
          const candidate = district + tj;
          addLogEntry(`Trying candidate (district + series+num): ${candidate}`, 'info');
          if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, j] };
        }
        if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 4, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
          const candidate = district + tj + tokens[j + 1];
          addLogEntry(`Trying candidate (district + letters + digits): ${candidate}`, 'info');
          if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, j, j + 1] };
        }
      }
    }

    // token = "KA" + next = "51"
    if (/^KA$/.test(t)) {
      if (i + 1 < tokens.length && /^\d{2}$/.test(tokens[i + 1])) {
        const district = 'KA' + tokens[i + 1];
        for (let j = i + 2; j <= Math.min(i + 5, tokens.length - 1); j++) {
          const tj = tokens[j];
          if (/^[A-Z]{1,2}\d{4}$/.test(tj)) {
            const candidate = district + tj;
            addLogEntry(`Trying candidate (KA + digits + series+num): ${candidate}`, 'info');
            if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, i + 1, j] };
          }
          if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 5, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
            const candidate = district + tj + tokens[j + 1];
            addLogEntry(`Trying candidate (KA + digits + letters + digits): ${candidate}`, 'info');
            if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, i + 1, j, j + 1] };
          }
        }
      }
    }

    // token like "KA51AK" then next "4247"
    if (/^KA\d{2}[A-Z]{1,2}$/.test(t)) {
      if (i + 1 < tokens.length && /^\d{4}$/.test(tokens[i + 1])) {
        const candidate = t + tokens[i + 1];
        addLogEntry(`Trying candidate (KA+letters + digits): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, i + 1] };
      }
    }

    // token = "AK4247" and previous tokens contain KA district
    if (/^[A-Z]{1,2}\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^KA\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 1] + t;
        addLogEntry(`Trying candidate (prev KA## + ${t}): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i - 1, i] };
      }
      if (i - 2 >= 0 && /^KA$/.test(tokens[i - 2]) && /^\d{2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA + digits + ${t}): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i - 2, i - 1, i] };
      }
    }

    // token = "4247" with letters and KA before it
    if (/^\d{4}$/.test(t)) {
      if (i - 1 >= 0 && /^[A-Z]{1,2}$/.test(tokens[i - 1]) && i - 2 >= 0 && /^KA\d{2}$/.test(tokens[i - 2])) {
        const candidate = tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA## + letters + digits): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i - 2, i - 1, i] };
      }
      if (i - 3 >= 0 && /^KA$/.test(tokens[i - 3]) && /^\d{2}$/.test(tokens[i - 2]) && /^[A-Z]{1,2}$/.test(tokens[i - 1])) {
        const candidate = tokens[i - 3] + tokens[i - 2] + tokens[i - 1] + t;
        addLogEntry(`Trying candidate (KA + digits + letters + digits): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i - 3, i - 2, i - 1, i] };
      }
    }
  }

  return null;
}

// ---------- Text processing (keeps your earlier behavior) ----------

function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');

  // Normalize newlines into spaces to retain token boundaries
  addLogEntry('Step 1: Normalizing newlines', 'step');
  const step1 = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ');
  addLogEntry(`Result: "${step1.substring(0, 80)}${step1.length > 80 ? '...' : ''}"`, 'info');

  // Replace non-alphanumeric chars with spaces to preserve token boundaries
  addLogEntry('Step 2: Replacing non-alphanumeric characters with spaces', 'step');
  const step2 = step1.replace(/[^A-Za-z0-9]/g, ' ');
  addLogEntry(`Result: "${step2.substring(0, 80)}${step2.length > 80 ? '...' : ''}"`, 'info');

  // Uppercase
  addLogEntry('Step 3: Converting to uppercase', 'step');
  const step3 = step2.toUpperCase();
  addLogEntry(`Result: "${step3.substring(0, 80)}${step3.length > 80 ? '...' : ''}"`, 'info');

  // Tokenize
  addLogEntry('Step 4: Tokenizing', 'step');
  const tokens = step3.split(/\s+/).filter(Boolean);
  addLogEntry(`Tokens: ${tokens.join(', ')}`, 'info');

  // Try to find plate using reconstruction
  addLogEntry('Step 5: Looking for Karnataka vehicle number (reconstructing if split)...', 'step');
  const found = findKAVehicleInTokens(tokens);

  if (found) {
    addLogEntry(`✓ Found Karnataka vehicle number: ${found.plate}`, 'success');
    return {
      processed: found.plate,
      found: true,
      allMatches: [found.plate],
      fullProcessed: step3,
      type: 'vehicle'
    };
  }

  addLogEntry('✗ No Karnataka vehicle number found', 'warning');
  return {
    processed: 'No KA vehicle number found',
    found: false,
    allMatches: [],
    fullProcessed: step3,
    type: 'none'
  };
}

// ---------- OCR wrapper (uses currentFile Blob) ----------

async function performOCR() {
  addLogEntry('Uploading image to OCR.Space API...', 'step');
  try {
    const formData = new FormData();
    formData.append('apikey', API_KEY);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');

    // currentFile must be a Blob/File ready for OCR
    formData.append('file', currentFile);

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.IsErroredOnProcessing) {
      const errorMsg = data.ErrorMessage || data.ErrorDetails || 'Unknown error';
      throw new Error(Array.isArray(errorMsg) ? errorMsg.join('; ') : errorMsg);
    }

    const results = data.ParsedResults || [];
    const extractedText = results
      .map(result => result.ParsedText?.trim())
      .filter(text => text && text.length > 0)
      .join('\n\n');

    if (extractedText) {
      addLogEntry(`OCR completed. Extracted ${extractedText.length} characters`, 'success');
      return extractedText;
    } else {
      addLogEntry('No text extracted from OCR', 'info');
      return null;
    }
  } catch (error) {
    addLogEntry(`OCR error: ${error.message}`, 'error');
    throw error;
  }
}

// ---------- Main extraction & UI flow (integrated) ----------

async function extractText() {
  if (!currentFile) {
    setStatus('Please select an image first', true);
    return;
  }

  setStatus('Processing image...');
  extractBtn.disabled = true;
  output.textContent = 'Processing...';
  processedOutput.textContent = 'Processing...';
  clearLog();

  try {
    const ocrData = await performOCR();

    if (!ocrData) {
      setStatus('No text detected in the image', true);
      output.textContent = 'No text found in the image.';
      processedOutput.textContent = 'No text to process';
      addLogEntry('No text extracted from image', 'error');
      return;
    }

    // Display raw text
    output.textContent = ocrData;
    addLogEntry(`Text extraction successful`, 'success');

    // Process the text
    const processResult = processText(ocrData);

    // Display processed result
    processedOutput.textContent = processResult.processed;
    processedOutput.className = `output processed-output ${processResult.found ? 'found' : 'not-found'}`;

    // Show copy button if we found a valid identifier
    copyBtn.style.display = processResult.found ? 'flex' : 'none';

    // Update status
    if (processResult.found) {
      setStatus(`✓ Found Karnataka vehicle number: ${processResult.processed}`);
      addLogEntry(`Processing completed successfully!`, 'success');
    } else {
      setStatus(`⚠ No Karnataka vehicle number pattern found`);
      addLogEntry(`Text processed but no vehicle number pattern detected`, 'warning');
    }
  } catch (error) {
    const errorMessage = error.message || 'Failed to process image';
    setStatus(`✗ ${errorMessage}`, true);
    output.textContent = `Error: ${errorMessage}`;
    processedOutput.textContent = 'Processing failed';
    addLogEntry(`Error: ${errorMessage}`, 'error');
  } finally {
    extractBtn.disabled = false;
  }
}

// ---------- File handling: unified pipeline for camera/gallery/pc ----------

async function handleFileInput(file) {
  if (!file) {
    addLogEntry('No file provided', 'warning');
    return;
  }
  addLogEntry(`File selected: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'info');

  if (!isValidImageFile(file)) {
    setStatus('Please select a valid image file (JPG, PNG, GIF)', true);
    addLogEntry('✗ Invalid file type', 'error');
    return;
  }

  // If file is larger than limit, preprocess until under limit
  if (!isFileSizeValid(file)) {
    setStatus('Image is large — preprocessing to meet OCR limit...');
    try {
      const processedBlob = await preprocessForOCR(file);
      if (processedBlob) {
        // set processed blob as currentFile and preview the processed image
        currentFile = new File([processedBlob], `processed_${file.name.replace(/\s+/g, '_')}.jpg`, { type: 'image/jpeg' });
        setPreviewFromBlob(currentFile);
        addLogEntry(`Using processed image for OCR (${Math.round(currentFile.size / 1024)} KB)`, 'success');
        setStatus('Image preprocessed and ready for OCR');
      } else {
        // fallback: if preprocessing failed, still try original (risky)
        addLogEntry('Preprocessing failed — using original file as fallback', 'warning');
        currentFile = file;
        showPreview(file);
        setStatus('Using original image (preprocess failed)');
      }
    } catch (err) {
      addLogEntry(`Preprocessing error: ${err.message}`, 'error');
      currentFile = file; // fallback to original
      showPreview(file);
      setStatus('Preprocess error — using original image', true);
    }
  } else {
    // File already within size limit - but still optionally preprocess lightly for OCR improvement
    // We'll do a light preprocess to boost OCR accuracy while preserving image if small
    try {
      // Balanced heuristic: if image is ≤1MB and larger than a modest size, do a light preprocess
      if (file.size > 200 * 1024) { // >200KB do light preprocess
        addLogEntry('File within limit — applying light preprocessing for OCR (preview will show processed image)', 'info');
        const lightBlob = await preprocessForOCR(file); // this will short-circuit if small enough
        if (lightBlob && lightBlob.size <= MAX_FILE_SIZE) {
          currentFile = new File([lightBlob], `processed_${file.name.replace(/\s+/g, '_')}.jpg`, { type: 'image/jpeg' });
          setPreviewFromBlob(currentFile);
          addLogEntry(`Light preprocess applied: ${Math.round(currentFile.size / 1024)} KB`, 'success');
        } else {
          // If preprocessing produced larger file (rare), fallback to original
          currentFile = file;
          showPreview(file);
        }
      } else {
        // Very small file — don't process (to avoid quality loss)
        currentFile = file;
        showPreview(file);
        addLogEntry('Small file — skipping preprocessing', 'info');
      }
      setStatus('Image loaded. Click Extract Text to process.');
    } catch (err) {
      addLogEntry(`Light preprocessing failed: ${err.message}`, 'warning');
      currentFile = file;
      showPreview(file);
      setStatus('Image loaded (preprocess failed). Click Extract Text to process.');
    }
  }
}

// ---------- Preview helpers (keeps your previous showPreview behaviour but for Files/Blobs) ----------

function showPreview(fileOrBlob) {
  // Accepts File or Blob
  addLogEntry('Loading image preview...', 'info');

  // If preview is an <img>, set src directly
  if (fileOrBlob instanceof Blob) {
    setPreviewFromBlob(fileOrBlob);
    addLogEntry('✓ Image preview loaded successfully', 'success');
    return;
  }

  // fallback for File via FileReader (keeps previous approach)
  const img = document.createElement('img');
  img.alt = 'Image preview';
  img.style.maxWidth = '100%';
  img.style.maxHeight = '200px';
  img.style.objectFit = 'contain';
  img.style.borderRadius = '8px';
  const reader = new FileReader();
  reader.onload = function (e) {
    img.src = e.target.result;
    preview.innerHTML = '';
    preview.appendChild(img);
    addLogEntry('✓ Image preview loaded successfully', 'success');
  };
  reader.onerror = function () {
    addLogEntry('✗ Failed to load image preview', 'error');
    preview.innerHTML = '<div class="preview-placeholder">Preview unavailable</div>';
    setStatus('Failed to load image preview', true);
  };
  if (fileOrBlob && fileOrBlob.size > 0) reader.readAsDataURL(fileOrBlob);
}

// ---------- Event wiring (camera/gallery/file/drop) ----------

function handleFile(file) {
  // This keeps your original naming but routes through unified pipeline
  handleFileInput(file);
}

function openCamera() {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/*';
  tempInput.setAttribute('capture', 'environment'); // back camera
  tempInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
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

  // File input change
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    handleFile(file);
  });

  // Camera / Gallery buttons
  if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
  if (galleryBtn) galleryBtn.addEventListener('click', openGallery);

  // Dropzone click => open file picker
  dropzone.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // Drag & drop handlers
  ['dragenter', 'dragover'].forEach(event => {
    dropzone.addEventListener(event, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(event => {
    dropzone.addEventListener(event, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  // Buttons
  clearBtn.addEventListener('click', clearAll);
  extractBtn.addEventListener('click', extractText);

  copyBtn.addEventListener('click', function () {
    const textToCopy = processedOutput.textContent;
    if (textToCopy && textToCopy !== 'Waiting for text extraction...' && textToCopy !== 'No KA vehicle number found') {
      copyToClipboard(textToCopy);
    }
  });

  // Log header toggle
  logHeader.addEventListener('click', () => {
    processingLog.classList.toggle('expanded');
    logToggle.classList.toggle('expanded');
  });

  // Keyboard accessibility for dropzone
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
}

// ---------- Remaining helpers kept from original ----------

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Vehicle number copied to clipboard!');
    addLogEntry('Vehicle number copied to clipboard', 'success');
    setTimeout(() => setStatus(''), 2000);
    return true;
  } catch (err) {
    console.error('Failed to copy text: ', err);
    setStatus('Failed to copy to clipboard', true);
    addLogEntry(`Copy error: ${err}`, 'error');
    return false;
  }
}

function clearAll() {
  currentFile = null;
  fileInput.value = '';
  output.textContent = 'Select an image to extract text...';
  processedOutput.textContent = 'Waiting for text extraction...';
  processedOutput.className = 'output processed-output';
  preview.innerHTML = '<div class="preview-placeholder">No image selected</div>';
  clearLog();
  setStatus('');
  copyBtn.style.display = 'none';

  if (lastPreviewURL) {
    URL.revokeObjectURL(lastPreviewURL);
    lastPreviewURL = null;
  }
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
