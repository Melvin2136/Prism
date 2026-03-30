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
    // The back arrow next to "Invoices" inside the job details view
    this.backButton  = page.locator('button.MuiIconButton-root:has(svg)').first();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Navigate directly to the Review Invoices page.
   */
  async goto() {
    await this.page.goto('https://prism-opc-dev.gnxsolutions.app/review');
    await this.searchInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /**
   * Type into the search bar to filter the jobs table.
   * @param {string} jobName 
   */
  async searchByJobName(jobName) {
    await this.searchInput.waitFor({ state: 'visible' });
    await this.searchInput.fill(jobName);
    
    // Wait for network idle to ensure the table filters completely
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }

  /**
   * Finds the specific job row by text and clicks its "View" button.
   * Make sure to search first if there are many jobs.
   * @param {string} jobName 
   */
  async clickAndViewJob(jobName) {
    const jobRow = this.tableRows.filter({ hasText: jobName }).first();
    // Wait generously for the row — PRISM's DB can take a few seconds to index a new job
    await jobRow.waitFor({ state: 'visible', timeout: 30_000 });

    const viewButton = jobRow.getByRole('button', { name: 'View', exact: true });
    await viewButton.click();

    // After clicking view, wait for the table showing the files to render.
    // The spec will handle waiting for the specific filenames sequentially.
    // Small generic delay to ensure React transition completes visually:
    await this.page.waitForTimeout(1000);
  }

  /**
   * Verifies that exact filenames are visible in the details table.
   * Does NOT use expects (assertions are kept in the spec). 
   * It returns true if all files are located.
   * 
   * @param {string[]} fileNames 
   * @returns {Promise<boolean>}
   */
  async areUploadedFilesVisible(fileNames) {
    for (const fileName of fileNames) {
      // Remove extension and normalize whitespace just in case PRISM trims it
      const baseName = fileName.replace(/\.[^/.]+$/, '').trim().replace(/\s+/g, ' ');
      
      const fileRow = this.tableRows.filter({ hasText: baseName }).first();
      try {
        await fileRow.waitFor({ state: 'visible', timeout: 15_000 });
      } catch (e) {
        console.error(`File NOT found in review table. Looking for: "${baseName}" (Original: ${fileName})`);
        return false;
      }
    }
    return true;
  }

  /**
   * Clicks the "Review" action button on the first file in the job's file list.
   * This transitions the app to the invoice validation (Phase 3) screen.
   */
  /**
   * Clicks the "Review" action button on the first file in the job's file list.
   * This transitions the app to the invoice validation (Phase 3) screen.
   * 
   * Includes a "Smart Reload" mechanism: if the status doesn't update from 
   * "Processing" to "Under Review" quickly, it reloads the page to force 
   * the UI to fetch the latest data from the server.
   * 
   * @param {string} jobName - Used to re-search after a page reload
   */
  async clickReviewOnFirstFile(jobName) {
    let isEnabled = false;
    const maxRetries = 10; 

    for (let i = 0; i < maxRetries; i++) {
        const reviewButton = this.page.getByRole('button', { name: 'Review', exact: true }).first();
        
        // Check if button is enabled
        try {
            // Short 5s wait to see if it flips naturally
            await reviewButton.waitFor({ state: 'visible', timeout: 5000 });
            isEnabled = await reviewButton.isEnabled();
        } catch (e) {
            isEnabled = false;
        }

        if (isEnabled) {
            console.log(`Success: Review button enabled.`);
            await reviewButton.click();
            return;
        }

        console.log(`Review button still disabled (Processing...). Attempt ${i+1}/${maxRetries}. Reloading...`);
        
        // Wait 10 seconds before reload
        await this.page.waitForTimeout(10_000);
        
        // Force a page reload to bypass SPA stale state
        await this.page.reload();
        await this.page.waitForLoadState('load');

        // Re-navigate to the job view after reload
        await this.searchByJobName(jobName);
        await this.clickAndViewJob(jobName);
    }

    throw new Error(`Review button did not become enabled for job "${jobName}" after multiple reloads.`);
  }
}

module.exports = { ReviewInvoicePage };
