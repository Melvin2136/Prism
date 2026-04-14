'use strict';

const fs = require('fs');

// ── pdf-parse import shim ────────────────────────────────────────────────────
// pdf-parse v1: module.exports = function(buffer) { ... }  (callable directly)
// pdf-parse v2: module.exports = { default: function(buffer) { ... } }
// We resolve whichever shape is present and validate it's callable.
function resolvePdfParse() {
  const raw = require('pdf-parse');
  if (typeof raw === 'function') return raw;           // v1
  if (raw && typeof raw.default === 'function') return raw.default; // v2 ESM-compat
  // Last-resort: some bundlers expose it under the module itself
  const keys = Object.keys(raw || {});
  for (const k of keys) {
    if (typeof raw[k] === 'function') return raw[k];
  }
  throw new Error('[pdfReader] Could not resolve a callable function from pdf-parse. Check your version.');
}

const pdf = resolvePdfParse();

/**
 * Extracts all raw text from a PDF file using pdf-parse.
 * @param {string} pdfPath - Absolute path to the PDF file
 * @returns {Promise<string>} The extracted text content
 */
async function extractTextFromPDF(pdfPath) {
  try {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found at: ${pdfPath}`);
    }
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text || '';
  } catch (e) {
    // Re-throw so callers (extractPDFFields) can catch and fall through to OCR
    throw e;
  }
}

module.exports = { extractTextFromPDF };

