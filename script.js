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

// Configuration
const API_KEY = 'K88494594188957';
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

// Karnataka vehicle number pattern: KA + 2 digits + 1 letter + 4 digits
const KA_VEHICLE_PATTERN = /KA\d{2}[A-Z]\d{4}/g;

// UPI ID pattern: Common formats including those starting with KA
const UPI_ID_PATTERN = /[a-zA-Z0-9.]{2,256}@[a-zA-Z0-9]{2,64}|[a-zA-Z0-9]{6,15}|KA[0-9A-Z]{6,8}/g;

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
  const vehicleMatches = step3.match(KA_VEHICLE_PATTERN);
  
  if (vehicleMatches && vehicleMatches.length > 0) {
    const vehicleNumber = vehicleMatches[0];
    addLogEntry(`✓ Found vehicle number: ${vehicleNumber}`, 'success');
    
    return {
      processed: vehicleNumber,
      found: true,
      allMatches: vehicleMatches,
      fullProcessed: step3,
      type: 'vehicle'
    };
  }
  
  // Step 5: Find UPI ID pattern if no vehicle number found
  addLogEntry('Step 5: Searching for UPI ID pattern', 'step');
  
  // First check the original text for UPI IDs (with special characters)
  let upiMatches = rawText.match(UPI_ID_PATTERN);
  
  // If not found, try the processed text
  if (!upiMatches || upiMatches.length === 0) {
    upiMatches = step3.match(UPI_ID_PATTERN);
  }
  
  if (upiMatches && upiMatches.length > 0) {
    // Filter out any matches that are too short or too long
    const validUpiMatches = upiMatches.filter(match => match.length >= 6 && match.length <= 15);
    
    if (validUpiMatches.length > 0) {
      const upiId = validUpiMatches[0];
      addLogEntry(`✓ Found UPI ID: ${upiId}`, 'success');
      
      return {
        processed: upiId,
        found: true,
        allMatches: validUpiMatches,
        fullProcessed: step3,
        type: 'upi'
      };
    }
  }
  
  // No matches found
  addLogEntry('✗ No Karnataka vehicle number or UPI ID pattern found', 'warning');
  return {
    processed: 'No valid identifier found',
    found: false,
    allMatches: [],
    fullProcessed: step3,
    type: 'none'
  };
}

// Copy to clipboard function
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    const isUpiId = processedOutput.classList.contains('upi-id');
    const isVehicleNumber = processedOutput.classList.contains('vehicle-number');
    
    let itemType = 'Item';
    if (isUpiId) {
      itemType = 'UPI ID';
    } else if (isVehicleNumber) {
      itemType = 'Vehicle number';
    }
    
    setStatus(`${itemType} copied to clipboard!`);
    addLogEntry(`${itemType} copied to clipboard`, 'success');
    setTimeout(() => {
      setStatus('');
    }, 2000);
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
  
  // Hide copy button when cleared
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
    
    // Add specific class for UPI IDs
    if (processResult.type === 'upi') {
      processedOutput.classList.add('upi-id');
    } else if (processResult.type === 'vehicle') {
      processedOutput.classList.add('vehicle-number');
    }
    
    // Adjust font size for mobile based on content length and type
    if (window.innerWidth <= 768) {
      if (processResult.processed.length > 8) {
        // Longer results need smaller font
        processedOutput.style.fontSize = '0.8rem';
        processedOutput.style.letterSpacing = '0';
        processedOutput.style.padding = '15px 5px';
      } else {
        // Standard mobile size for shorter results
        processedOutput.style.fontSize = '0.9rem';
        processedOutput.style.letterSpacing = '0.02em';
        processedOutput.style.padding = '20px 8px';
      }
    } else {
      // Reset styles for desktop
      processedOutput.style.fontSize = '';
      processedOutput.style.letterSpacing = '';
      processedOutput.style.padding = '';
    }
    
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
  // Create a temporary file input with camera capture
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/*';
  tempInput.setAttribute('capture', 'environment'); // Use the back camera
  
  // Handle the file selection
  tempInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });
  
  // Trigger the file selection dialog
  tempInput.click();
  
  // Log for debugging
  addLogEntry('Opening camera...', 'info');
}

function openGallery() {
  // Use the existing file input but ensure no capture attribute
  // This ensures it opens the gallery/storage instead of camera
  if (fileInput.hasAttribute('capture')) {
    fileInput.removeAttribute('capture');
  }
  fileInput.click();
  
  // Log for debugging
  addLogEntry('Opening gallery/storage...', 'info');
}

// Event listeners
function setupEventListeners() {
  // Ensure file input doesn't have capture attribute by default
  if (fileInput.hasAttribute('capture')) {
    fileInput.removeAttribute('capture');
  }
  
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

  // Make dropzone click open gallery instead of camera
  dropzone.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    // Open gallery when dropzone is clicked
    fileInput.click();
  });
  
  // Copy button click event
  copyBtn.addEventListener('click', function() {
    const textToCopy = processedOutput.textContent;
    if (textToCopy && textToCopy !== 'Waiting for text extraction...' && textToCopy !== 'No KA vehicle number found') {
      copyToClipboard(textToCopy);
    }
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
