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

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    uploadPage = new UploadInvoicePage(page);

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

    // Upload all files from tests/files/ dynamically
    await uploadPage.uploadMultipleFiles(files);

    // Submit
    await uploadPage.clickUploadAndProcess();

    // ── Assert: Success ───────────────────────────────────────────────────────
    // Accept any of: success toast visible, URL changed, OR job name appears in the page
    // (PRISM's toast can disappear quickly; the URL may stay at /upload)
    const successMessageVisible = await uploadPage.successMessage
      .isVisible()
      .catch(() => false);

    const urlChanged = /dashboard|review|job/i.test(page.url());
    
    // New: check if the job name or any file is now listed on the page
    const jobListed = await page.getByText(jobName, { exact: false }).isVisible().catch(() => false);

    expect(
      successMessageVisible || urlChanged || jobListed,
      `Expected a success message, URL change, or job listing after upload.\nCurrent URL: ${page.url()}`
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
