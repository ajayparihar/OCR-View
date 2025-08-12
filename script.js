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

// Configuration
const API_KEY = 'K88494594188957';
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Karnataka vehicle number pattern: KA + 2 digits + 1 letter + 4 digits
const KA_VEHICLE_PATTERN = /KA\d{2}[A-Z]\d{4}/g;

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
  // Ensure log is closed after clearing
  processingLog.classList.remove('expanded');
  logToggle.classList.remove('expanded');
}

// Text processing function
function processText(rawText) {
  addLogEntry('Starting text processing...', 'step');
  
  // Step 1: Remove newline characters
  addLogEntry('Step 1: Removing newline characters', 'step');
  const step1 = rawText.replace(/\n/g, '').replace(/\r/g, '');
  addLogEntry(`Result: "${step1.substring(0, 50)}${step1.length > 50 ? '...' : ''}"`, 'info');
  
  // Step 2: Filter whitelist characters (A-Z, a-z, 0-9)
  addLogEntry('Step 2: Filtering non-whitelisted characters', 'step');
  const step2 = step1.replace(/[^A-Za-z0-9]/g, '');
  addLogEntry(`Result: "${step2.substring(0, 50)}${step2.length > 50 ? '...' : ''}"`, 'info');
  
  // Step 3: Convert to uppercase
  addLogEntry('Step 3: Converting to uppercase', 'step');
  const step3 = step2.toUpperCase();
  addLogEntry(`Result: "${step3.substring(0, 50)}${step3.length > 50 ? '...' : ''}"`, 'info');
  
  // Step 4: Find KA vehicle number pattern
  addLogEntry('Step 4: Searching for Karnataka vehicle number pattern (KA##A####)', 'step');
  const matches = step3.match(KA_VEHICLE_PATTERN);
  
  if (matches && matches.length > 0) {
    const vehicleNumber = matches[0];
    addLogEntry(`✓ Found vehicle number: ${vehicleNumber}`, 'success');
    
    return {
      processed: vehicleNumber,
      found: true,
      allMatches: matches,
      fullProcessed: step3
    };
  } else {
    addLogEntry('✗ No Karnataka vehicle number pattern found', 'warning');
    return {
      processed: 'No KA vehicle number found',
      found: false,
      allMatches: [],
      fullProcessed: step3
    };
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
  
  reader.onload = function(e) {
    try {
      img.src = e.target.result;
      preview.innerHTML = '';
      preview.appendChild(img);
      addLogEntry('✓ Image preview loaded successfully', 'success');
    } catch (error) {
      addLogEntry(`Image preview error: ${error.message}`, 'error');
      preview.innerHTML = '<div class="preview-placeholder">Preview unavailable</div>';
    }
  };
  
  reader.onerror = function() {
    addLogEntry('✗ Failed to load image preview', 'error');
    preview.innerHTML = '<div class="preview-placeholder">Preview unavailable</div>';
    setStatus('Failed to load image preview', true);
  };
  
  // Check if file is valid before reading
  if (file && file.size > 0) {
    reader.readAsDataURL(file);
  } else {
    addLogEntry('✗ Invalid file for preview', 'error');
    preview.innerHTML = '<div class="preview-placeholder">Invalid file</div>';
  }
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
    // Perform OCR
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
  // Create a temporary file input with camera capture
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/*';
  tempInput.capture = 'environment'; // Use the back camera
  
  // Handle the file selection
  tempInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });
  
  // Trigger the file selection dialog
  tempInput.click();
}

function openGallery() {
  // Use the existing file input but without capture attribute
  fileInput.capture = ''; // Remove any capture attribute
  fileInput.click();
}

// Event listeners
function setupEventListeners() {
  // File input change handler
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    handleFile(file);
  });
  
  // Mobile camera and gallery buttons
  if (cameraBtn) {
    cameraBtn.addEventListener('click', openCamera);
  }
  
  if (galleryBtn) {
    galleryBtn.addEventListener('click', openGallery);
  }

  // Prevent dropzone from interfering with file input
  dropzone.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
  });

  // Drag and drop handlers
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

  // Button handlers
  clearBtn.addEventListener('click', clearAll);
  extractBtn.addEventListener('click', extractText);

  // Log toggle functionality - UPDATED FOR CLOSED BY DEFAULT
  logHeader.addEventListener('click', () => {
    processingLog.classList.toggle('expanded');
    logToggle.classList.toggle('expanded');
  });

  // Keyboard accessibility
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
  setStatus('OCR View v0.1 ready to extract text from images');
  clearLog();
  
  addLogEntry('=== OCR View v0.1 Initialized ===', 'success');
  addLogEntry('Processing log starts closed - click header to expand', 'info');
  addLogEntry('Ready to process images', 'info');
});
