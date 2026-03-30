'use strict';

const path = require('path');

class UploadInvoicePage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── Form fields ─────────────────────────────────────────────────────────
    this.jobNameInput      = page.getByPlaceholder('Enter job name');
    this.customerNameInput = page.getByPlaceholder('Enter customer name');

    // ── File upload ──────────────────────────────────────────────────────────
    // Hidden <input type="file" multiple> triggered by the "Select Files" btn
    this.selectFilesButton = page.getByRole('button', { name: /select files/i });
    this.fileInput         = page.locator('input[type="file"]');

    // The submit button appears after files are selected.
    // Use getByRole with a broad name pattern - works even if PRISM changes exact text.
    this.uploadAndProcessButton = page.getByRole('button', { name: /upload.*process|upload \d+ file|submit/i });

    // ── Post-upload feedback ─────────────────────────────────────────────────
    // Matches any success toast / heading / status text the app may render
    this.successMessage = page.getByText(/success|uploaded successfully|job created|processing started/i);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Navigate directly to the upload page (use after login if needed).
   */
  async goto() {
    await this.page.goto('https://prism-opc-dev.gnxsolutions.app/upload');
    await this.waitForUploadForm();
  }

  /**
   * Wait until the upload form is fully rendered and the Job Name field is
   * interactive — avoids brittle timeouts.
   */
  async waitForUploadForm() {
    await this.jobNameInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Actions required by the spec (interface contract)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Click the "Upload Invoice" sidebar button on the Dashboard.
   * Call this from DashboardPage instead when using the full POM flow;
   * it is kept here as a convenience shortcut.
   */
  async clickUploadInvoice() {
    await this.page.getByRole('button', { name: 'Upload Invoice' }).click();
    await this.waitForUploadForm();
  }

  /**
   * Fill the mandatory Job Name field.
   * PRISM disables the file picker until a job name is present.
   * @param {string} name
   */
  async enterJobName(name) {
    await this.jobNameInput.click();
    await this.jobNameInput.fill(name);
    // Fallback: if fill() doesn't trigger React's onChange, type character by character
    const filledValue = await this.jobNameInput.inputValue();
    if (!filledValue) {
      await this.jobNameInput.pressSequentially(name, { delay: 50 });
    }
    // Wait for the file-upload area to become enabled after name entry
    await this.selectFilesButton.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /**
   * Upload multiple files by intercepting the native file chooser.
   * We ALWAYS start the listener BEFORE clicking the button to avoid race conditions.
   * Falls back to direct setInputFiles on the hidden input if chooser fails.
   *
   * @param {string[]} filePaths - Absolute paths produced by fileHelper.js.
   */
  async uploadMultipleFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) {
      throw new Error('uploadMultipleFiles: filePaths array must not be empty');
    }

    // Start listening BEFORE clicking to avoid race condition
    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 15_000 });
    await this.selectFilesButton.click();
    
    try {
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(filePaths);
      console.log(`[upload] Set ${filePaths.length} file(s) via fileChooser event.`);
    } catch (e) {
      console.log('[upload] fileChooser timed out, falling back to direct setInputFiles...');
      const fileInput = this.page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(filePaths);
      console.log(`[upload] Set ${filePaths.length} file(s) via direct setInputFiles.`);
    }

    // CRITICAL: Wait for the React UI to re-render and show the uploaded file list.
    // The Upload button only appears AFTER the file names are rendered in the DOM.
    // We wait for the first file name (without extension) to appear on the page.
    const firstFileName = filePaths[0].split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
    try {
      await this.page.getByText(firstFileName, { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
      console.log(`[upload] File list rendered in UI: "${firstFileName}" is visible.`);
    } catch (e) {
      console.log(`[upload] File name "${firstFileName}" not visible in UI, but continuing...`);
    }
  }

  /**
   * Click the "Upload & Process" submit button and wait for navigation or
   * network activity to settle so the success message has time to appear.
   */
  async clickUploadAndProcess() {
    // Wait for the button to appear after files are rendered (up to 60s).
    // Try primary locator first, then a broader fallback.
    let btn = this.uploadAndProcessButton;
    try {
      await btn.waitFor({ state: 'visible', timeout: 60_000 });
    } catch (e) {
      // Fallback: any button on the page with 'Upload' but not 'Invoice'
      console.log('[upload] Primary button locator timed out, trying JS fallback...');
      await this.page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const uploadBtn = btns.find(b => 
          /upload/i.test(b.textContent) && 
          !/invoice/i.test(b.textContent)
        );
        if (uploadBtn) uploadBtn.click();
        else throw new Error('Upload button not found via JS fallback');
      });
      return;
    }
    const count = await btn.count();
    console.log(`[upload] Found ${count} upload button(s). Clicking first...`);
    await btn.first().click();
  }
}

module.exports = { UploadInvoicePage };
