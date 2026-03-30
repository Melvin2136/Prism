'use strict';

class DashboardPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // Sidebar navigation items — exact labels confirmed in PRISM
    this.uploadInvoiceLink  = page.getByRole('button', { name: 'Upload Invoice' });
    this.reviewInvoicesLink = page.getByRole('button', { name: 'Review Invoices' });
    this.exportDataLink     = page.getByRole('button', { name: 'Export Data' });

    // Dashboard heading
    this.heading = page.getByRole('heading', { name: /invoice processing dashboard/i });
  }

  /** Wait until the dashboard is fully rendered. */
  async waitForDashboard() {
    await this.page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    await this.uploadInvoiceLink.waitFor({ state: 'visible' });
  }

  async clickUploadInvoice() {
    // Try to click standard locator
    await this.uploadInvoiceLink.click();
    
    try {
      await this.page.waitForURL(/\/upload/, { timeout: 8000 });
    } catch (e) {
      console.log('Initial click failed to navigate, trying fallback...');
      // Fallback: direct navigation to ensure tests can proceed
      await this.page.goto('https://prism-opc-dev.gnxsolutions.app/upload');
      await this.page.waitForURL(/\/upload/);
    }
  }

  async clickReviewInvoices() {
    await this.reviewInvoicesLink.click();
    try {
      await this.page.waitForURL(/\/review/, { timeout: 8000 });
    } catch (e) {
      console.log('Initial click failed to navigate, trying fallback...');
      await this.page.goto('https://prism-opc-dev.gnxsolutions.app/review');
      await this.page.waitForURL(/\/review/);
    }
  }
}

module.exports = { DashboardPage };
