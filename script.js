// DOM Elements
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

// Configuration
const API_KEY = 'K88494594188957';
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Strict Karnataka vehicle number final pattern: KA##A#### or KA##AA####
const KA_VEHICLE_PATTERN = /^KA\d{2}[A-Z]{1,2}\d{4}$/;

// Global state
let currentFile = null;

// Utility functions
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

/**
 * Attempts to find and reconstruct a KA vehicle number from tokenized OCR text.
 * Accepts split forms like: ["KA","51","IND","AK4247"] => KA51AK4247
 * Returns { plate, indices } or null.
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

    // Case: token is "KA##" (e.g., "KA51")
    if (/^KA\d{2}$/.test(t)) {
      const district = t;
      // look ahead up to 4 tokens to allow small noise tokens in-between
      for (let j = i + 1; j <= Math.min(i + 4, tokens.length - 1); j++) {
        const tj = tokens[j];
        // letters + 4 digits in one token (e.g., "AK4247")
        if (/^[A-Z]{1,2}\d{4}$/.test(tj)) {
          const candidate = district + tj;
          addLogEntry(`Trying candidate (district + series+num): ${candidate}`, 'info');
          if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, j] };
        }
        // letters only + next token 4 digits (e.g., "AK" + "4247")
        if (/^[A-Z]{1,2}$/.test(tj) && j + 1 <= Math.min(i + 4, tokens.length - 1) && /^\d{4}$/.test(tokens[j + 1])) {
          const candidate = district + tj + tokens[j + 1];
          addLogEntry(`Trying candidate (district + letters + digits): ${candidate}`, 'info');
          if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, j, j + 1] };
        }
      }
    }

    // Case: token is "KA" followed by "51"
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

    // Case: token like "KA51AK" (missing the final 4 digits)
    if (/^KA\d{2}[A-Z]{1,2}$/.test(t)) {
      if (i + 1 < tokens.length && /^\d{4}$/.test(tokens[i + 1])) {
        const candidate = t + tokens[i + 1];
        addLogEntry(`Trying candidate (KA+letters + digits): ${candidate}`, 'info');
        if (plateRegex.test(candidate)) return { plate: candidate, indices: [i, i + 1] };
      }
    }

    // Case: token is series+number e.g., "AK4247" and previous tokens contain KA district
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

    // Case: token is 4 digits e.g., "4247" and previous tokens are letters and KA district
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

// Text processing function
function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');

  // Step 1: Remove newline characters (but keep as separators)
  addLogEntry('Step 1: Normalizing newlines', 'step');
  const step1 = rawText.replace(/\r/g, ' ').replace(/\n/g, ' ');
  addLogEntry(`Result: "${step1.substring(0, 80)}${step1.length > 80 ? '...' : ''}"`, 'info');

  // Step 2: Replace non-alphanumeric with spaces (preserve token boundaries)
  addLogEntry('Step 2: Replacing non-alphanumeric characters with spaces', 'step');
  const step2 = step1.replace(/[^A-Za-z0-9]/g, ' ');
  addLogEntry(`Result: "${step2.substring(0, 80)}${step2.length > 80 ? '...' : ''}"`, 'info');

  // Step 3: Convert to uppercase
  addLogEntry('Step 3: Converting to uppercase', 'step');
  const step3 = step2.toUpperCase();
  addLogEntry(`Result: "${step3.substring(0, 80)}${step3.length > 80 ? '...' : ''}"`, 'info');

  // Step 4: Tokenize
  addLogEntry('Step 4: Tokenizing', 'step');
  const tokens = step3.split(/\s+/).filter(Boolean);
  addLogEntry(`Tokens: ${tokens.join(', ')}`, 'info');

  // Step 5: Try to find KA plate via smart reconstruction
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

// Copy to clipboard
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

// UI functions
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
}

function showPreview(file) {
  addLogEntry('Loading image preview...', 'info');
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
  if (file && file.size > 0) reader.readAsDataURL(file);
}

function handleFile(file) {
  if (!file) {
    addLogEntry('No file selected', 'warning');
    return;
  }
  addLogEntry(`File selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`, 'info');
  if (!isValidImageFile(file)) {
    setStatus('Please select a valid image file (JPG, PNG, GIF)', true);
    addLogEntry('✗ Invalid file type', 'error');
    return;
  }
  if (!isFileSizeValid(file)) {
    setStatus('Image too large. Please use images under 1MB', true);
    addLogEntry('✗ File too large (max 1MB)', 'error');
    return;
  }
  currentFile = file;
  showPreview(file);
  setStatus('Image loaded. Click Extract Text to process.');
  addLogEntry('✓ File validation passed', 'success');
}

// OCR function
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

// Main extraction function
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

// Mobile camera and gallery functions
function openCamera() {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/*';
  tempInput.setAttribute('capture', 'environment'); // Use the back camera
  tempInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });
  tempInput.click();
  addLogEntry('Opening camera...', 'info');
}

function openGallery() {
  if (fileInput.hasAttribute('capture')) {
    fileInput.removeAttribute('capture');
  }
  fileInput.click();
  addLogEntry('Opening gallery/storage...', 'info');
}

// Event listeners
function setupEventListeners() {
  if (fileInput.hasAttribute('capture')) {
    fileInput.removeAttribute('capture');
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    handleFile(file);
  });

  if (cameraBtn) {
    cameraBtn.addEventListener('click', openCamera);
  }

  if (galleryBtn) {
    galleryBtn.addEventListener('click', openGallery);
  }

  dropzone.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  copyBtn.addEventListener('click', function () {
    const textToCopy = processedOutput.textContent;
    if (textToCopy && textToCopy !== 'Waiting for text extraction...' && textToCopy !== 'No KA vehicle number found') {
      copyToClipboard(textToCopy);
    }
  });

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
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  clearBtn.addEventListener('click', clearAll);
  extractBtn.addEventListener('click', extractText);

  logHeader.addEventListener('click', () => {
    processingLog.classList.toggle('expanded');
    logToggle.classList.toggle('expanded');
  });

  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setStatus('OCR View v0.1 ready to extract KA vehicle numbers');
  clearLog();
  addLogEntry('=== OCR View v0.1 Initialized ===', 'success');
  addLogEntry('Processing log starts closed - click header to expand', 'info');
  addLogEntry('Ready to process images', 'info');
});
