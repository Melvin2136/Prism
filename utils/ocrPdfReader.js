'use strict';

/**
 * ocrPdfReader.js
 *
 * OCR-based text extractor for scanned / image-only PDFs.
 *
 * Strategy
 * ────────
 * 1. Spin up a tiny local HTTP server to serve the PDF
 *    (file:// and data: URIs block Chrome's PDF plugin).
 * 2. Open a NON-headless Chromium window (headless:false) — Chrome's built-in
 *    PDF viewer only activates in headed mode.
 * 3. Navigate to http://localhost:<port>/invoice.pdf — Chrome renders the PDF.
 * 4. Use CDP (Page.captureScreenshot) to grab a full-resolution screenshot.
 * 5. Run Tesseract.js OCR on the screenshot.
 * 6. Repeat for multiple pages via Page.pdf-navigation or PageDown key.
 * 7. Shut down server, return all text.
 *
 * Prerequisites: npm install tesseract.js   (already done)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const net  = require('net');

// ── Free port finder ──────────────────────────────────────────────────────────
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

// ── Static HTTP server for the PDF file ──────────────────────────────────────
function startPDFServer(filePath, port) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}  pdfPath       Absolute path to the PDF file.
 * @param {*}      _unused        Kept for backwards-compat (ignored).
 * @param {object} [opts]
 * @param {number}  [opts.maxPages=4]
 * @param {number}  [opts.viewportWidth=1440]
 * @param {number}  [opts.viewportHeight=1980]
 * @param {number}  [opts.renderDelayMs=3500]
 * @param {number}  [opts.pageDelayMs=1500]
 * @param {boolean} [opts.debug=false]   Print raw OCR text to console.
 * @returns {Promise<string>}
 */
async function ocrExtractFromPDF(pdfPath, _unused, opts = {}) {
  const {
    maxPages       = 4,
    viewportWidth  = 1440,
    viewportHeight = 1980,
    renderDelayMs  = 3500,
    pageDelayMs    = 1500,
    debug          = false,
  } = opts;

  // ── Dependency checks ─────────────────────────────────────────────────────
  let createWorker;
  try { ({ createWorker } = require('tesseract.js')); }
  catch { throw new Error('[ocrPdfReader] tesseract.js not installed. Run: npm install tesseract.js'); }

  let chromium;
  try { ({ chromium } = require('@playwright/test')); }
  catch { ({ chromium } = require('playwright')); }

  // ── Start local HTTP server ───────────────────────────────────────────────
  const port   = await getFreePort();
  const server = await startPDFServer(pdfPath, port);
  const pdfUrl = `http://127.0.0.1:${port}/invoice.pdf`;

  console.log(`\n[ocrPdfReader] Serving PDF at ${pdfUrl}`);
  console.log(`[ocrPdfReader] Opening headed browser for PDF rendering (headless cannot render PDFs).`);

  const texts = [];
  let browser = null;

  try {
    // ── Launch HEADED browser — Chrome's PDF plugin requires headed mode ─────
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
      ],
    });

    const context = await browser.newContext({
      viewport:        { width: viewportWidth, height: viewportHeight },
      acceptDownloads: false,
    });

    const pdfPage = await context.newPage();

    // Navigate — Chrome's PDF viewer will render the document
    await pdfPage.goto(pdfUrl, { waitUntil: 'load', timeout: 20_000 });

    // Wait for Chrome's PDF renderer to fully paint all content
    await pdfPage.waitForTimeout(renderDelayMs);

    console.log(
      `[ocrPdfReader] PDF rendered. Starting Tesseract OCR across up to ${maxPages} page(s).\n` +
      `  ℹ️  Tesseract language data is cached after first download.`
    );

    const worker    = await createWorker('eng', 1, { logger: () => {} });
    const seenSizes = new Set();

    for (let pass = 0; pass < maxPages; pass++) {
      const screenshot = await pdfPage.screenshot({ type: 'png', fullPage: false });

      // De-duplicate: if screenshot is same size as previous, we've hit end-of-doc
      if (seenSizes.has(screenshot.length) && pass > 0) {
        console.log(`[ocrPdfReader]  Page ${pass + 1}: same as previous — end of document.`);
        break;
      }
      seenSizes.add(screenshot.length);

      const { data: { text } } = await worker.recognize(screenshot);
      const cleaned = (text ?? '').replace(/\f/g, '\n').trim();

      console.log(`[ocrPdfReader]  Page ${pass + 1}: ${cleaned.length} chars extracted.`);

      if (debug && cleaned.length > 0) {
        console.log(`\n──── Raw OCR text (Page ${pass + 1}) ────\n${cleaned}\n──────────────────────────────────\n`);
      }

      if (cleaned.length < 30) {
        console.log('[ocrPdfReader]  Very little text — stopping early.');
        break;
      }

      const alreadyCovered = texts.some(t => t.includes(cleaned.slice(0, 80)));
      if (!alreadyCovered) texts.push(cleaned);

      if (pass + 1 < maxPages) {
        await pdfPage.keyboard.press('PageDown');
        await pdfPage.waitForTimeout(pageDelayMs);
      }
    }

    await worker.terminate();

  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }

  const combined = texts.join('\n\n--- page break ---\n\n');
  console.log(`\n[ocrPdfReader] Done. ${combined.length} total chars from ${texts.length} page(s).`);
  return combined;
}

module.exports = { ocrExtractFromPDF };
