'use strict';

/**
 * PRISM – Upload Invoice Positive Flow
 *
 * Spec file: assertions live HERE. Page classes contain zero expects.
 *
 * Pre-requisites
 * ──────────────
 * • Set environment variables (or copy .env.example → .env):
 *     PRISM_EMAIL=business@prism.ai
 *     PRISM_PASSWORD=Business@123
 * • Place test files in: tests/files/
 *   Supported: .pdf .docx .jpg .jpeg .png  (max 25 MB each per PRISM)
 */

const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');
const { UploadInvoicePage } = require('../pages/UploadInvoicePage');
const { ReviewInvoicePage } = require('../pages/ReviewInvoicePage');
const { loadFilesFromFolder } = require('../utils/fileHelper');
const path = require('path');

// ── Credentials ─────────────────────────────────────────────────────────────
const EMAIL = process.env.PRISM_EMAIL ?? 'business@prism.ai';
const PASSWORD = process.env.PRISM_PASSWORD ?? 'Business@123';

// ── Files directory ──────────────────────────────────────────────────────────
const FILES_DIR = path.resolve(__dirname, '..', '..', 'temp');

// ── Test suite ───────────────────────────────────────────────────────────────
test.describe('PRISM – Upload Invoice', () => {

  /** Shared page objects — re-initialised per test via beforeEach */
  let loginPage;
  let dashboardPage;
  let uploadPage;
  let reviewPage;

  test.beforeEach(async ({ page }) => {
    loginPage  = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    uploadPage = new UploadInvoicePage(page);
    reviewPage = new ReviewInvoicePage(page);

    // Step 1 — Login
    await loginPage.goto();
    await loginPage.login(EMAIL, PASSWORD);

    // Step 2 — Confirm dashboard
    await dashboardPage.waitForDashboard();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-01  Happy path: upload multiple invoices successfully
  // ──────────────────────────────────────────────────────────────────────────
  test('TC01 – User can upload multiple invoice files from the dashboard', async ({ page }) => {
    // Give extra time for the upload + PRISM processing
    test.setTimeout(120_000);

    // ── Arrange ──────────────────────────────────────────────────────────────
    const files = loadFilesFromFolder(FILES_DIR); // dynamic — no hardcoded paths

    // ── Act ───────────────────────────────────────────────────────────────────

    // Navigate via sidebar
    await dashboardPage.clickUploadInvoice();

    // Assert: Upload page reached
    await expect(page).toHaveURL(/\/upload/i, { timeout: 15_000 });

    // Wait for form to be ready
    await uploadPage.waitForUploadForm();

    // Assert: Job Name field is visible and mandatory
    await expect(uploadPage.jobNameInput).toBeVisible();

    // Keep under PRISM's ~20 char job name limit
    const jobName = `QA-${String(Date.now()).slice(-8)}`;
    await uploadPage.enterJobName(jobName);

    // Upload all files from tests/temp/ dynamically
    await uploadPage.uploadMultipleFiles(files);

    // Submit
    await uploadPage.clickUploadAndProcess();

    // ── Assert: Success (multi-signal resilient check) ────────────────────────
    // PRISM's upload may: show a toast (which disappears fast), redirect, OR just
    // silently reset the form. We poll for any of these signals for up to 15s.
    console.log('[TC01] Waiting for upload success signal...');

    let successDetected = false;
    const deadline = Date.now() + 15_000;

    while (Date.now() < deadline && !successDetected) {
      const [toastVisible, urlChanged, jobListed, btnGone] = await Promise.all([
        // 1. Toast / success text appeared
        uploadPage.successMessage.isVisible().catch(() => false),
        // 2. URL moved away from /upload
        Promise.resolve(/dashboard|review|job/i.test(page.url())),
        // 3. Job name appears in the page content (some PRISM versions list it)
        page.getByText(jobName, { exact: false }).isVisible().catch(() => false),
        // 4. The Upload & Process button is gone (form reset = upload accepted)
        uploadPage.uploadAndProcessButton.isHidden().catch(() => false),
      ]);

      if (toastVisible || urlChanged || jobListed || btnGone) {
        successDetected = true;
        console.log(
          `[TC01] ✅ Upload success detected:\n` +
          `  toast=${toastVisible} | urlChanged=${urlChanged} | jobListed=${jobListed} | btnGone=${btnGone}`
        );
      } else {
        await page.waitForTimeout(1000);
      }
    }

    // ── Fallback: navigate to /review and verify the job was indexed ──────────
    if (!successDetected) {
      console.log('[TC01] No immediate success signal — checking /review page for job row...');
      await reviewPage.goto();
      await reviewPage.searchByJobName(jobName);

      // Give PRISM up to 20s to index the newly uploaded job
      try {
        await page.getByText(jobName, { exact: false }).waitFor({ state: 'visible', timeout: 20_000 });
        successDetected = true;
        console.log('[TC01] ✅ Job found on /review page — upload was successful.');
      } catch {
        console.warn('[TC01] Job not found on /review either.');
      }
    }

    expect(
      successDetected,
      `Upload did not produce any success signal.\nCurrent URL: ${page.url()}\n` +
      `Check /review manually for job: "${jobName}"`
    ).toBeTruthy();
  });



  // ──────────────────────────────────────────────────────────────────────────
  // TC-03  Upload page is reachable and renders required elements
  // ──────────────────────────────────────────────────────────────────────────
  test('TC03 – Upload Invoice page loads all required form elements', async ({ page }) => {

    await dashboardPage.clickUploadInvoice();
    await expect(page).toHaveURL(/\/upload/i);
    await uploadPage.waitForUploadForm();

    await expect(uploadPage.jobNameInput).toBeVisible();
    await expect(uploadPage.customerNameInput).toBeVisible();
    await expect(uploadPage.selectFilesButton).toBeVisible();
  });

});
