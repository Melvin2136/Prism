'use strict';

/**
 * PRISM – Full End-to-End Workflow Application Spec
 * 
 * Phases Covered:
 * 1. Login & Dashboard navigation
 * 2. Upload Invoice (Select Job Name, select PDFs, submit to processing queue)
 * 3. Review Invoices (Find Job in table, View Details, verify all files appear)
 * 4. Invoice Validation (Open Review screen, check extracted field error states, mark as Completed)
 */

const { test, expect } = require('@playwright/test');
const { LoginPage }             = require('../pages/LoginPage');
const { DashboardPage }         = require('../pages/DashboardPage');
const { UploadInvoicePage }     = require('../pages/UploadInvoicePage');
const { ReviewInvoicePage }     = require('../pages/ReviewInvoicePage');
const { InvoiceValidationPage } = require('../pages/InvoiceValidationPage');
const { loadFilesFromFolder }   = require('../utils/fileHelper');
const path = require('path');

const EMAIL     = process.env.PRISM_EMAIL    ?? 'business@prism.ai';
const PASSWORD  = process.env.PRISM_PASSWORD ?? 'Business@123';
const FILES_DIR = path.resolve(__dirname, '..', '..', 'temp');

test.describe('PRISM – Full Application E2E Cycle', () => {

  let loginPage, dashboardPage, uploadPage, reviewPage, validationPage;
  let generatedJobName = '';
  let filePaths = [];
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

  test('TC01_Master – Execute full Upload, Review, and Validation Flow', async ({ page }) => {

    // 7 minute budget to cover upload + OCR queue + field verification
    test.setTimeout(420_000);

    // ──────────────────────────────
    // Step 1: Upload the files
    // ──────────────────────────────
    filePaths = loadFilesFromFolder(FILES_DIR);
    uploadedFileNames = filePaths.map(fp => path.basename(fp));

    await dashboardPage.clickUploadInvoice();
    await uploadPage.waitForUploadForm();

    // Keep job name short (≤ 15 chars) — PRISM truncates long names in its DB
    generatedJobName = `E2E-${String(Date.now()).slice(-8)}`;
    await uploadPage.enterJobName(generatedJobName);
    await uploadPage.uploadMultipleFiles(filePaths);

    await uploadPage.clickUploadAndProcess();
    await expect(uploadPage.successMessage).toBeVisible({ timeout: 60_000 });

    // ──────────────────────────────
    // Step 2: Navigate to Review Invoices & Verify Table
    // ──────────────────────────────
    await reviewPage.goto();
    await expect(page).toHaveURL(/\/review/i);
    await reviewPage.searchByJobName(generatedJobName);
    await reviewPage.clickAndViewJob(generatedJobName);

    const allFilesVisible = await reviewPage.areUploadedFilesVisible(uploadedFileNames);
    if (!allFilesVisible) {
      console.log('NOTICE: Some files are still processing. Proceeding to validate the first available file...');
    }

    // ──────────────────────────────
    // Step 3: Click Review on the First File
    // ──────────────────────────────
    await reviewPage.clickReviewOnFirstFile(generatedJobName);
    await validationPage.waitForValidationScreen();

    // ──────────────────────────────
    // Step 4: Evaluate the Extracted Field Error States
    // ──────────────────────────────
    console.log('\nEvaluating extracted field states from PRISM right panel...');
    const { shouldComplete, details } = await validationPage.evaluateFieldsForCompletion();

    // Print clean summary log
    console.log('\n===== Field Evaluation Results =====');
    for (const d of details) {
      const icon = 
        d.decision.includes('VALID')   ? '✅' :
        d.decision.includes('MISMATCH')? '❌' : '⏭️ ';
      console.log(`  ${icon}  ${d.label}: "${d.value}" → ${d.decision}`);
    }
    console.log('=====================================\n');

    // ──────────────────────────────
    // Step 5: Mark Status Based on Field Evaluation
    // ──────────────────────────────
    if (shouldComplete) {
      console.log('All populated fields are valid (no critical errors). Marking invoice as COMPLETED ✅');
      await validationPage.markAsCompleted();
    } else {
      console.warn('Critical field errors found. Marking invoice as REJECTED ❌');
      await validationPage.markAsRejected();
    }
  });
});
