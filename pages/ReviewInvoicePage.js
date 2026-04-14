'use strict';

class ReviewInvoicePage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── Table & Search ────────────────────────────────────────────────────────
    this.searchInput = page.locator('input[placeholder="Search jobs, customers or users"]');
    this.tableRows   = page.getByRole('row');

    // ── Back Navigation ───────────────────────────────────────────────────────
    this.backButton  = page.locator('button.MuiIconButton-root:has(svg)').first();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Navigation
  // ────────────────────────────────────────────────────────────────────────────

  /** Navigate directly to the Review Invoices page and wait for search bar. */
  async goto() {
    await this.page.goto('https://prism-opc-dev.gnxsolutions.app/review');
    await this.searchInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2a: Search by Job Name
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Types the job name into PRISM's search bar and waits for results.
   * @param {string} jobName  e.g. "E2E-15146861"
   */
  async searchByJobName(jobName) {
    console.log(`[review] Searching Review Invoice table for job: "${jobName}"`);
    await this.searchInput.waitFor({ state: 'visible', timeout: 10_000 });
    await this.searchInput.fill('');
    await this.page.waitForTimeout(400);
    await this.searchInput.fill(jobName);
    // Wait for PRISM's debounced API call to return results
    await this.page.waitForTimeout(2000);
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2b: Click View on the Job Row
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Finds the job row in the Review Invoice table and clicks its "View" button.
   *
   * PRISM can take 30–90s to index a newly uploaded job.
   * Strategy: poll with page reload every 10s for up to 3 minutes.
   * The row may appear even with status "Processing" — we click View immediately.
   * The "Under Review" wait happens INSIDE the job detail (Step 2c).
   *
   * @param {string} jobName  e.g. "E2E-15146861"
   */
  async clickViewForJob(jobName) {
    const maxAttempts = 24; // 24 × 10s = 4 minutes

    // Build a simplified search keyword in case PRISM's API doesn't handle
    // special chars (underscore, dash). e.g. "QA_Automation -1" → "QA"
    const simplifiedSearch = jobName.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/)[0];

    for (let i = 0; i < maxAttempts; i++) {
      // ── Strategy 1: search by the exact job name ───────────────────────
      try {
        await this.searchInput.waitFor({ state: 'visible', timeout: 8_000 });
        await this.searchInput.fill('');
        await this.page.waitForTimeout(400);
        await this.searchInput.fill(jobName);
        await this.page.waitForTimeout(2000);
        await this.page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      } catch { /* continue to row check */ }

      let jobRow = this.tableRows.filter({ hasText: jobName }).first();
      let rowFound = await jobRow.isVisible().catch(() => false);

      // ── Strategy 2: if 0 rows returned, try simplified keyword ─────────
      if (!rowFound) {
        console.log(`[review] Exact search returned no rows. Trying simplified keyword: "${simplifiedSearch}"...`);
        try {
          await this.searchInput.fill('');
          await this.page.waitForTimeout(300);
          await this.searchInput.fill(simplifiedSearch);
          await this.page.waitForTimeout(2000);
          await this.page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        } catch { /* continue */ }

        // Re-check rows — now filter by full job name from broader results
        jobRow = this.tableRows.filter({ hasText: jobName }).first();
        rowFound = await jobRow.isVisible().catch(() => false);
      }

      if (rowFound) {
        console.log(`[review] ✅ Job row "${jobName}" found (attempt ${i + 1}). Clicking "View"...`);
        const viewBtn = jobRow.getByRole('button', { name: 'View', exact: true });
        await viewBtn.click();
        await this.page.waitForTimeout(1500);
        return;
      }

      console.log(`[review] Job "${jobName}" not found yet. Attempt ${i + 1}/${maxAttempts}. Reloading in 10s...`);
      await this.page.waitForTimeout(10_000);
      await this.page.reload({ waitUntil: 'load' });
      await this.searchInput.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    }

    throw new Error(
      `[review] Job "${jobName}" never appeared in the Review Invoice table after ${maxAttempts} attempts (~4 min).\n` +
      `Possible causes: upload failed silently, PRISM backend unreachable, or job name format not searchable.`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2c: Inside the job detail — wait for "Under Review" then click Review
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Waits for the invoice file status to change from "Processing" → "Under Review",
   * then clicks the "Review" button in the Actions column.
   *
   * PRISM's OCR backend is async — the Review button stays DISABLED while
   * the file is still processing. This loop reloads the page every 10s
   * to get the latest status from the server.
   *
   * @param {string} jobName  Used to re-search and re-open the job after each reload
   */
  async clickReviewOnFirstFile(jobName) {
    const maxRetries = 12; // 12 × 10s = 2 minutes

    for (let i = 0; i < maxRetries; i++) {
      // Check if the Review button is visible and enabled
      const reviewBtn = this.page.getByRole('button', { name: 'Review', exact: true }).first();
      let isEnabled = false;

      try {
        await reviewBtn.waitFor({ state: 'visible', timeout: 5_000 });
        isEnabled = await reviewBtn.isEnabled();
      } catch {
        isEnabled = false;
      }

      if (isEnabled) {
        console.log(`[review] ✅ "Review" button enabled — status is now "Under Review". Clicking...`);
        await reviewBtn.click();
        return;
      }

      // Log what status text is visible
      const isProcessing = await this.page.locator('text=Processing').first().isVisible().catch(() => false);
      const statusLabel  = isProcessing ? '"Processing"' : 'unknown';
      console.log(`[review] Invoice still ${statusLabel}. "Review" button not yet enabled. Attempt ${i + 1}/${maxRetries}. Reloading in 10s...`);

      await this.page.waitForTimeout(10_000);

      // Reload and re-navigate back to the job detail
      await this.page.reload({ waitUntil: 'load' });
      await this.page.waitForLoadState('domcontentloaded');
      await this.searchByJobName(jobName);
      await this.clickViewForJob(jobName);
    }

    throw new Error(
      `[review] "Review" button never became enabled for job "${jobName}" after ${maxRetries} reloads (~2 min).\n` +
      `The file may still be in Processing state. Check PRISM's OCR backend.`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Assertions
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Checks that all uploaded file names are visible inside the job detail view.
   * @param {string[]} fileNames
   * @returns {Promise<boolean>}
   */
  async areUploadedFilesVisible(fileNames) {
    for (const fileName of fileNames) {
      const baseName = fileName.replace(/\.[^/.]+$/, '').trim().replace(/\s+/g, ' ');
      const fileRow  = this.tableRows.filter({ hasText: baseName }).first();
      try {
        await fileRow.waitFor({ state: 'visible', timeout: 15_000 });
        console.log(`[review] ✅ File visible in job detail: "${baseName}"`);
      } catch {
        console.error(`[review] ❌ File NOT visible in job detail: "${baseName}"`);
        return false;
      }
    }
    return true;
  }
}

module.exports = { ReviewInvoicePage };
