'use strict';

class InvoiceValidationPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── Status Action Buttons ────────────────────────────────────────────────
    // Primary orange "Mark Review" button
    this.markReviewButton    = page.getByRole('button', { name: 'Mark Review', exact: true });
    // Status Menu items revealed by the dropdown arrow (bottom-right)
    this.markCompletedOption = page.getByRole('menuitem', { name: 'Mark Completed' });
    this.markRejectedOption  = page.getByRole('menuitem', { name: 'Mark Rejected' });
    this.markReviewOption    = page.getByRole('menuitem', { name: 'Mark Review' });
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Waits for the Invoice validation screen to fully load.
   */
  async waitForValidationScreen() {
    await this.markReviewButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Open the status dropdown (the small arrow button to the right of "Mark Review").
   * Uses JavaScript to reliably click the arrow adjacent to the Mark Review button.
   */
  async openStatusDropdown() {
    // Find the dropdown trigger: it's a small button next to "Mark Review".
    // We find the Mark Review button then click its sibling arrow button.
    const opened = await this.page.evaluate(() => {
      const allBtns = [...document.querySelectorAll('button')];
      const markReviewBtn = allBtns.find(b => b.textContent.trim() === 'Mark Review');
      if (markReviewBtn) {
        // The dropdown arrow is usually the next sibling button or a button in the same container
        const parent = markReviewBtn.parentElement;
        const sibling = parent ? parent.querySelector('button:last-child') : null;
        if (sibling && sibling !== markReviewBtn) {
          sibling.click();
          return true;
        }
      }
      return false;
    });

    if (!opened) {
      // Fallback: look for aria-haspopup buttons
      const arrowBtn = this.page.locator('button[aria-haspopup]').last();
      await arrowBtn.click();
    }

    // Wait for the menu to render
    await this.markCompletedOption.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Reads field values and error states from the right panel IN THE CORRECT UI ORDER.
   * The order matches exactly what appears top-to-bottom in PRISM "Invoice Headers".
   * @returns {Promise<Array<{label, value, hasError, errorMsg}>>}
   */
  async extractAllFieldStates() {
    // Explicitly define the field order as seen in PRISM right panel (all 4 sections, top → bottom)
    const FIELD_ORDER = [
      // ── Invoice Headers ──────────────────────────────────────────────
      'IRN No',
      'PO Number',
      'Invoice No',
      'Length Of IRN No.',
      'State Code',
      'Invoice Date',
      'Currency Code',
      'Length Of Invoice',
      'Proforma Invoice No',
      'Invoice Received Date',
      'Proforma Invoice Date',
      'Site Id Ref No As Per Po',
      'Site Id Ref No As Per Invoice',

      // ── Delivery Details ─────────────────────────────────────────────
      'SCH State',
      'Delivery Address',
      'Gstin Opc As Per Po',
      'Delivery State As Per Po',
      'GSTIN (OPC as mentioned on INV)',
      'Delivery State As Per Invoice',

      // ── Vendor Details ───────────────────────────────────────────────
      'PAN (Vendor)',
      'Vendor Code',
      'Vendor Name',
      'Vendor Address (Mentioned on Inv)',
      'Gstin Vendor As Per Po',
      'Vendor State As Per Po',
      'GSTIN (Vendor as mentioned on INV)',
      'Vendor State As Per Invoice',

      // ── Line Items (fields repeated per item row) ────────────────────
      'Sr No',
      'UOM',
      'Qty (Invoice)',
      'Qty (PO)',
      'Unit Rate (Invoice)',
      'Unit Rate (PO)',
      'Line Amount',
      'Total Bill Amount',
      'Total Bill Amount in INR',
      'Labour Amt (Invoice)',
      'Labour Amt (PO)',
      'Material Amt (Invoice)',
      'Material Amt (PO)',
      'Other Charges (Invoice)',
      'Other Charges (PO)',
      'Asset Type',
      'Asset Category',
      'Asset Sub Type',
      'Asset Description as per Invoice',
      'Asset Description as per PO',
      'Asset Serial Number',
      'Gst Rate Percent',
      'HSN Code as per Invoice',
      'SAC Code as per Invoice',
      'HSN Code as per PO',
      'SAC Code as per PO',
      'IGST (Goods)',
      'CGST (Goods)',
      'S/UTGST (Goods)',
      'IGST (Services)',
      'CGST (Services)',
      'S/UTGST (Services)',
    ];

    const results = [];

    for (const fieldLabel of FIELD_ORDER) {
      const data = await this.page.evaluate((label) => {
        // Find the label element matching this field name
        const labels = [...document.querySelectorAll('label, p, span, div')];
        let container = null;
        
        for (const el of labels) {
          if (el.textContent.trim() === label) {
            container = el.closest('[class*="MuiFormControl"], [class*="form-group"], div');
            if (container) break;
          }
        }

        if (!container) return { label, value: '', hasError: false, errorMsg: '' };

        // Read the input value
        const input = container.querySelector('input, textarea');
        const value = input ? input.value.trim() : '';

        // Detect error messages
        let hasError = false;
        let errorMsg = '';
        const errorEl = container.querySelector('p, span');
        if (errorEl) {
          const txt = errorEl.textContent.trim();
          if (txt && txt !== label) {
            hasError = true;
            errorMsg = txt;
          }
        }

        return { label, value, hasError, errorMsg };
      }, fieldLabel);

      results.push(data);
    }

    return results;
  }

  /**
   * Evaluates all extracted fields and determines whether to mark as Completed.
   * 
   * Rules:
   * - Empty fields (Field is null)  → SKIP (acceptable per user instruction)
   * - "PO number not found in master" → SKIP (known test data gap)
   * - Non-empty fields with no error → VALID, counts toward match
   * - Non-empty fields with unexpected errors → LOG as mismatch
   * 
   * @returns {Promise<{shouldComplete: boolean, details: Array}>}
   */
  async evaluateFieldsForCompletion() {
    const fields = await this.extractAllFieldStates();

    // ── Debug: show everything Playwright found in the right panel ───────────
    console.log(`\n[DEBUG] Playwright found ${fields.length} fields in the right panel:`);
    if (fields.length === 0) {
      console.warn('[DEBUG] ⚠️  No fields were detected! The label+input selector may need updating.');
    }
    for (const f of fields) {
      const errorNote = f.hasError ? ` | ⚠️  ERROR: "${f.errorMsg}"` : '';
      console.log(`[DEBUG]   label="${f.label}" | value="${f.value}"${errorNote}`);
    }
    console.log('[DEBUG] ─────────────────────────────────────────────────\n');
    // ─────────────────────────────────────────────────────────────────────────

    // Known ignorable errors (test environment limitations)
    const IGNORABLE_ERRORS = [
      /field is null/i,
      /not found in master/i,
    ];

    const details = [];
    let hasCriticalError = false;

    for (const f of fields) {
      if (!f.value) {
        details.push({ ...f, decision: 'SKIPPED (empty)' });
        continue;
      }

      if (f.hasError) {
        const isIgnorable = IGNORABLE_ERRORS.some(re => re.test(f.errorMsg));
        if (isIgnorable) {
          details.push({ ...f, decision: `SKIPPED (${f.errorMsg})` });
        } else {
          details.push({ ...f, decision: `MISMATCH - ${f.errorMsg}` });
          hasCriticalError = true;
        }
      } else {
        details.push({ ...f, decision: 'VALID ✅' });
      }
    }

    console.log(`[DEBUG] Evaluation complete. hasCriticalError=${hasCriticalError} | shouldComplete=${!hasCriticalError}\n`);
    return { shouldComplete: !hasCriticalError, details };
  }

  /**
   * Clicks the dropdown arrow and selects "Mark Completed".
   */
  async markAsCompleted() {
    await this.openStatusDropdown();
    await this.markCompletedOption.click();
    await this.page.waitForTimeout(2000);
    console.log('Invoice marked as Completed ✅');
  }

  /**
   * Clicks the dropdown arrow and selects "Mark Rejected".
   */
  async markAsRejected() {
    await this.openStatusDropdown();
    await this.markRejectedOption.click();
    await this.page.waitForTimeout(2000);
    console.log('Invoice marked as Rejected ❌');
  }
}

module.exports = { InvoiceValidationPage };
