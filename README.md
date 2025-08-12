# Image to Text OCR Web Application

[Live Application](https://ajayparihar.github.io/OCR-View/)

A modern, responsive web application that extracts text from images using the OCR.Space API. Features a beautiful glassomorphic UI design with drag-and-drop functionality and mobile camera support.

![OCR Web App](https://img.shields.io/badge/OCR-Web%20Application-blue) ![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=flat&logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=flat&logo=css3&logoColor=white) ![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=flat&logo=javascript&logoColor=%23F7DF1E)

## 📋 Table of Contents

- [Features](#features)
- [Demo](#demo)
- [Installation](#installation)
- [Usage](#usage)
- [File Structure](#file-structure)
- [API Configuration](#api-configuration)
- [Browser Support](#browser-support)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- **🎨 Modern Glassomorphic UI** - Beautiful, responsive design with glass-like effects
- **📱 Mobile-First Design** - Works seamlessly on desktop, tablet, and mobile devices
- **📷 Camera Support** - Direct camera capture on mobile devices
- **🖱️ Drag & Drop** - Intuitive file upload with drag-and-drop functionality
- **🔄 Real-time Preview** - Instant image preview before processing
- **⚡ Fast Processing** - Quick OCR text extraction using OCR.Space API
- **📝 Text Output** - Clean, formatted text extraction results
- **🛡️ Error Handling** - Comprehensive error handling and user feedback
- **♿ Accessibility** - Keyboard navigation and screen reader support

## 🚀 Demo

### Live Demo
[View Live Application](https://ajayparihar.github.io/OCR-View/)


## 📦 Installation

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge)
- OCR.Space API key (free registration required)

### Quick Start

1. **Clone or Download** the project files
```

git clone https://github.com/yourusername/ocr-web-app.git
cd ocr-web-app

```

2. **File Structure** - Ensure you have these files:
```

ocr-web-app/
├── index.html
├── style.css
├── script.js
└── README.md

```

3. **Get API Key** (see [API Configuration](#api-configuration))

4. **Configure API Key** in `script.js`:
```

const API_KEY = 'YOUR_API_KEY_HERE';

```

5. **Open in Browser**
```

open index.html

```

## 🎯 Usage

### Basic Usage

1. **Select Image**
   - Click the dropzone area to browse files
   - Or drag and drop an image file
   - On mobile: Choose between camera or gallery

2. **Process Image**
   - Click "Extract Text" button
   - Wait for processing (typically 2-5 seconds)

3. **View Results**
   - Extracted text appears in the output panel
   - Copy text as needed

### Supported Formats

| Format | Extension | Max Size |
|--------|-----------|----------|
| JPEG   | `.jpg`, `.jpeg` | 1MB |
| PNG    | `.png` | 1MB |
| GIF    | `.gif` | 1MB |

### Mobile Features

- **Camera Capture**: Direct photo capture using device camera
- **Touch-Friendly**: Optimized for touch interactions
- **Responsive Layout**: Adapts to different screen sizes

## 📁 File Structure

```

ocr-web-app/
│
├── index.html          \# Main HTML structure
├── style.css           \# Glassomorphic styling and responsive design
├── script.js           \# Application logic and OCR processing
└── README.md           \# This documentation file

```

### File Descriptions

#### `index.html`
- Semantic HTML5 structure
- Accessible form elements
- Mobile viewport configuration

#### `style.css`
- CSS Custom Properties (CSS Variables)
- Glassomorphic design system
- Responsive grid layout
- Smooth animations and transitions

#### `script.js`
- ES6+ JavaScript features
- Modular function organization
- Event handling and DOM manipulation
- OCR.Space API integration

## 🔑 API Configuration

### Getting Your Free API Key

1. **Visit OCR.Space Registration**
   - Go to: **https://ocr.space/ocrapi/freekey**
   - Enter your email address
   - Click "Get Free API Key"

2. **Check Your Email**
   - You'll receive an API key instantly
   - No credit card required
   - No phone verification needed

3. **Free Tier Includes**
   - ✅ 25,000 requests per month
   - ✅ File size up to 1MB
   - ✅ English language support
   - ✅ Multiple image formats
   - ✅ No expiration

### API Configuration Steps

1. **Open `script.js`**
2. **Find the API_KEY constant**:
```

const API_KEY = 'K88494594188957'; // Replace with your key

```
3. **Replace with your actual API key**
4. **Save the file**

### API Documentation
- **Official Docs**: https://ocr.space/ocrapi
- **Supported Languages**: English (eng)
- **Rate Limits**: 25,000 requests/month (free tier)
- **Response Format**: JSON

## 🌐 Browser Support

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 80+ | ✅ Full Support |
| Firefox | 75+ | ✅ Full Support |
| Safari | 13+ | ✅ Full Support |
| Edge | 80+ | ✅ Full Support |
| Mobile Safari | iOS 13+ | ✅ Full Support |
| Chrome Mobile | Android 8+ | ✅ Full Support |

### Required Features
- **FileReader API** - For image preview
- **Fetch API** - For OCR requests
- **FormData** - For file uploads
- **CSS Grid** - For responsive layout
- **CSS Custom Properties** - For theming

## ⚠️ Limitations

### Technical Limitations
- **File Size**: Maximum 1MB per image (OCR.Space free tier)
- **Language**: English text only
- **Internet Required**: Requires active internet connection
- **API Limits**: 25,000 requests per month (free tier)

### Image Quality Tips
- **High Contrast**: Black text on white background works best
- **Good Resolution**: Minimum 300 DPI recommended
- **Clear Text**: Avoid blurry or skewed images
- **Proper Lighting**: Ensure text is clearly visible

## 🛠️ Customization

### Styling
Modify CSS custom properties in `style.css`:

```

:root {
--bg: \#0b1020;              /* Background color */
--accent: \#5b8cff;          /* Primary accent color */
--text: \#ffffff;            /* Text color */
--card-border: rgba(255, 255, 255, 0.1); /* Border color */
}

```

### Configuration
Adjust settings in `script.js`:

```

const MAX_FILE_SIZE = 1024 * 1024; // File size limit (1MB)
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];

```

## 🔧 Troubleshooting

### Common Issues

**"403 Forbidden" Error**
- Check if API key is correctly configured
- Verify API key is valid and not expired
- Ensure you haven't exceeded monthly quota

**"No text detected"**
- Try images with higher contrast
- Ensure text is clearly visible
- Check image quality and resolution

**File Upload Not Working**
- Verify file size is under 1MB
- Check file format is supported
- Try refreshing the page

**Mobile Camera Not Working**
- Ensure HTTPS connection (required for camera access)
- Check browser permissions for camera
- Try using Chrome or Safari on mobile

### Debug Mode
Enable console logging by adding to `script.js`:
```

const DEBUG_MODE = true;

```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.