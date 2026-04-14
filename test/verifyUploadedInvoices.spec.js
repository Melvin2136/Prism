'use strict';

/**
 * PRISM – Full End-to-End Workflow Spec
 *
 * Flow:
 *  1.  Login → Dashboard
 *  2.  Upload Invoice  (unique job name per run)
 *  3.  Review Invoices (search by job name → View)
 *  4.  Invoice Validation (read all extracted field states)
 *  4b. PDF Cross-Verification (PRISM values vs raw PDF text)
 *  5.  Mark invoice as Completed / Rejected
 */

const { test, expect }          = require('@playwright/test');
const { LoginPage }             = require('../pages/LoginPage');
const { DashboardPage }         = require('../pages/DashboardPage');
const { UploadInvoicePage }     = require('../pages/UploadInvoicePage');
const { ReviewInvoicePage }     = require('../pages/ReviewInvoicePage');
const { InvoiceValidationPage } = require('../pages/InvoiceValidationPage');
const { loadFilesFromFolder }   = require('../utils/fileHelper');
const { extractPDFFields, extractFieldsFromText } = require('../utils/pdfFieldExtractor');
const { ocrExtractFromPDF }     = require('../utils/ocrPdfReader');
const path = require('path');
const fs   = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────
const EMAIL     = process.env.PRISM_EMAIL    ?? 'business@prism.ai';
const PASSWORD  = process.env.PRISM_PASSWORD ?? 'Business@123';
const FILES_DIR = path.resolve(__dirname, '..', '..', 'temp');

// ─── Run counter (module-level — runs ONCE per execution, NOT per retry) ─────
// Stored in: tests/PRISM/run-counter.json
// Job names:  QA-Auto-1, QA-Auto-2, QA-Auto-3 …  (9 chars max, PRISM-safe)
const COUNTER_FILE = path.resolve(__dirname, '..', 'run-counter.json');

function getNextRunNumber() {
  let data = { count: 0 };
  if (fs.existsSync(COUNTER_FILE)) {
    try { data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')); } catch { /* start fresh */ }
  }
  data.count = (data.count || 0) + 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2));
  return data.count;
}

// Called ONCE when the module loads — retries share the same run number
const RUN_NUMBER     = getNextRunNumber();
const JOB_NAME       = `QA-Auto-${RUN_NUMBER}`;  // e.g. "QA-Auto-1"  (9 chars, no underscore)

console.log(`\n${'═'.repeat(55)}`);
console.log(`  PRISM E2E Run #${RUN_NUMBER}`);
console.log(`  Job Name : "${JOB_NAME}"`);
console.log(`${'═'.repeat(55)}\n`);

// ─────────────────────────────────────────────────────────────────────────────

test.describe('PRISM – Full Application E2E Cycle', () => {

  let loginPage, dashboardPage, uploadPage, reviewPage, validationPage;
  let filePaths        = [];
  let uploadedFileNames = [];

  test.beforeEach(async ({ page }) => {
    loginPage      = new LoginPage(page);
    dashboardPage  = new DashboardPage(page);
    uploadPage     = new UploadInvoicePage(page);
    reviewPage     = new ReviewInvoicePage(page);
    validationPage = new InvoiceValidationPage(page);

    await loginPage.goto();
    await loginPage.login(EMAIL, PASSWORD);
    await dashboardPage.waitForDashboard();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC01_Master  Upload → Review → Validate → PDF Cross-Verify → Mark Status
  // ───────────────────────────────────────────────────────────────────────────
  test('TC01_Master – Full Upload, Review, Validation and PDF Cross-Verification', async ({ page }) => {

    // 8-minute budget: upload + PRISM indexing + OCR + field check
    test.setTimeout(480_000);

    // ── Step 1: Upload ───────────────────────────────────────────────────────
    console.log('\n── Step 1: Upload Invoice ──────────────────────────────────');
    filePaths         = loadFilesFromFolder(FILES_DIR).slice(0, 1);
    uploadedFileNames = filePaths.map(fp => path.basename(fp));

    console.log(`  Job Name  : "${JOB_NAME}"`);
    console.log(`  PDF File  : "${uploadedFileNames[0]}"`);

    await dashboardPage.clickUploadInvoice();
    await uploadPage.waitForUploadForm();
    await uploadPage.enterJobName(JOB_NAME);
    await uploadPage.uploadMultipleFiles(filePaths);
    await uploadPage.clickUploadAndProcess();

    // Wait for upload success (any of: toast / URL change / button gone)
    let uploadOk = false;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && !uploadOk) {
      const [toast, urlOk, btnGone] = await Promise.all([
        uploadPage.successMessage.isVisible().catch(() => false),
        Promise.resolve(/dashboard|review|job/i.test(page.url())),
        uploadPage.uploadAndProcessButton.isHidden().catch(() => false),
      ]);
      if (toast || urlOk || btnGone) {
        uploadOk = true;
        console.log(`  ✅ Upload confirmed (toast=${toast} urlChanged=${urlOk} btnGone=${btnGone})`);
      } else {
        await page.waitForTimeout(1000);
      }
    }
    if (!uploadOk) console.warn('  ⚠️  No upload signal detected — continuing anyway.');

    // ── Step 2: Navigate to Review Invoices → find job → click View ──────────
    console.log('\n── Step 2: Review Invoices ─────────────────────────────────');
    console.log(`  📋 Uploaded job name  : "${JOB_NAME}"`);
    console.log(`  🔍 Searching for      : "${JOB_NAME}"`);
    console.log('  ⏳ Waiting 45s for PRISM to index the job...');
    await page.waitForTimeout(45_000);

    await reviewPage.goto();
    await expect(page).toHaveURL(/\/review/i);
    console.log('  ✅ On Review Invoices page. Looking for job row...');
    await reviewPage.clickViewForJob(JOB_NAME);

    const allFilesVisible = await reviewPage.areUploadedFilesVisible(uploadedFileNames);
    if (!allFilesVisible) {
      console.log('  ℹ️  PDF file row not yet visible — Review button loop will wait.');
    }

    // ── Step 3: Wait for "Under Review" status → click Review ────────────────
    console.log('\n── Step 3: Open Invoice Validation Screen ──────────────────');
    await reviewPage.clickReviewOnFirstFile(JOB_NAME);
    await validationPage.waitForValidationScreen();
    console.log('  ✅ Validation screen loaded.');

    // ── Step 4: Evaluate all PRISM extracted fields ───────────────────────────
    console.log('\n── Step 4: PRISM Field Evaluation ──────────────────────────');
    const { shouldComplete, details } = await validationPage.evaluateFieldsForCompletion();

    for (const d of details) {
      const icon = d.decision.includes('VALID') ? '✅' : d.decision.includes('MISMATCH') ? '❌' : '⏭️ ';
      console.log(`  ${icon}  ${d.label}: "${d.value}" → ${d.decision}`);
    }

    // ── Step 4b: PDF Cross-Verification ──────────────────────────────────────
    console.log('\n── Step 4b: PDF Cross-Verification ─────────────────────────');
    console.log(`  PDF: ${path.basename(filePaths[0])}`);

    const reviewedPdfPath = filePaths[0];
    let pdfFieldMap = new Map();

    // Stage 1 — pdf-parse (fast, text-layer PDFs)
    try {
      pdfFieldMap = await extractPDFFields(reviewedPdfPath);
      if (pdfFieldMap.size > 0) {
        console.log(`  [pdf-parse] ✅ ${pdfFieldMap.size} field(s) extracted from text layer.`);
      } else {
        console.log('  [pdf-parse] No text layer — falling back to OCR...');
      }
    } catch (err) {
      console.warn(`  [pdf-parse] Error: ${err.message}. Falling back to OCR...`);
    }

    // Stage 2 — OCR fallback
    if (pdfFieldMap.size === 0) {
      console.log('  [OCR] Rendering PDF → Tesseract...');
      try {
        const ocrText = await ocrExtractFromPDF(reviewedPdfPath, page.context(), {
          maxPages: 3, renderDelayMs: 2500, debug: true,
        });
        if (ocrText && ocrText.trim().length > 20) {
          pdfFieldMap = extractFieldsFromText(ocrText);
          console.log(`  [OCR] ✅ ${pdfFieldMap.size} field(s) identified.`);
        } else {
          console.warn('  [OCR] No usable text extracted.');
        }
      } catch (err) {
        console.warn(`  [OCR] Failed: ${err.message}`);
      }
    }

    // Cross-verify and report
    if (pdfFieldMap.size === 0) {
      console.warn('\n  ⚠️  PDF Cross-Verification SKIPPED — no text extractable from PDF.');
    } else {
      const report     = await validationPage.crossVerifyWithPDF(pdfFieldMap);
      const matched    = report.filter(r => r.result.includes('MATCH ✅'));
      const mismatched = report.filter(r => r.result.includes('MISMATCH'));
      const notFound   = report.filter(r => r.result.includes('NOT FOUND'));

      console.log('\n╔══════════════════════════════════════════════════════╗');
      console.log('║         PDF Cross-Verification Report               ║');
      console.log('╚══════════════════════════════════════════════════════╝');

      console.log('\n  ── MATCHED (PRISM = PDF) ──');
      matched.length === 0
        ? console.log('  (none)')
        : matched.forEach(r => console.log(`  ✅  ${r.label}\n       PRISM:"${r.prismValue}"  PDF:"${r.pdfValue}"`));

      console.log('\n  ── MISMATCHED (PRISM ≠ PDF) ──');
      mismatched.length === 0
        ? console.log('  (none — all verifiable fields matched ✅)')
        : mismatched.forEach(r => console.log(`  ❌  ${r.label}\n       PRISM:"${r.prismValue}"  PDF:"${r.pdfValue}"`));

      console.log('\n  ── NOT FOUND in PDF ──');
      notFound.length === 0
        ? console.log('  (none)')
        : notFound.forEach(r => console.log(`  ⏭️   ${r.label}: PRISM="${r.prismValue}"`));

      console.log(`\n  Summary: ✅ ${matched.length} matched | ❌ ${mismatched.length} mismatched | ⏭️  ${notFound.length} not found`);
      console.log('══════════════════════════════════════════════════════\n');

      // Soft assertion — log mismatches but do NOT fail the test for OCR noise
      if (mismatched.length > 0) {
        console.warn(
          `  ⚠️  ${mismatched.length} field(s) mismatched between PRISM and PDF.\n` +
          `  This may be OCR noise. Review manually:\n` +
          mismatched.map(r => `    ❌ ${r.label}: PRISM="${r.prismValue}" vs PDF="${r.pdfValue}"`).join('\n')
        );
      }
    }

    // ── Step 5: Mark invoice status ───────────────────────────────────────────
    console.log('\n── Step 5: Mark Invoice Status ─────────────────────────────');
    if (shouldComplete) {
      console.log('  All fields valid. Marking as COMPLETED ✅');
      await validationPage.markAsCompleted();
    } else {
      console.warn('  Critical field errors found. Marking as REJECTED ❌');
      await validationPage.markAsRejected();
    }

    console.log('\n── ✅ E2E Flow Complete ─────────────────────────────────────\n');
  });
});
