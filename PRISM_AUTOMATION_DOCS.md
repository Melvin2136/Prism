# PRISM Invoice Automation – Documentation

## Overview

End-to-end Playwright automation for the PRISM invoice processing workflow.  
**Base URL:** `https://prism-opc-dev.gnxsolutions.app`  
**Credentials:** `business@prism.ai` / `Business@123`

---

## Directory Structure

```
tests/PRISM/
├── pages/                        # Page Object Model (POM) classes
│   ├── LoginPage.js              # Login screen
│   ├── DashboardPage.js          # Dashboard + sidebar navigation
│   ├── UploadInvoicePage.js      # Upload Invoice form
│   ├── ReviewInvoicePage.js      # Review Invoices table & job view
│   └── InvoiceValidationPage.js  # Invoice review modal (right panel)
├── test/
│   ├── uploadInvoice.spec.js     # TC01: Upload-only test
│   └── verifyUploadedInvoices.spec.js  # TC01_Master: Full E2E test
├── utils/
│   ├── fileHelper.js             # Dynamic file loader from folder
│   └── pdfReader.js              # PDF text extraction utility
└── PRISM_AUTOMATION_DOCS.md      # This file

tests/temp/                       # Place invoice PDFs here for upload
```

---

## Running the Tests

```bash
# Full E2E (upload → review → validate → mark complete)
npx playwright test tests/PRISM/test/verifyUploadedInvoices.spec.js --headed

# Upload-only test
npx playwright test tests/PRISM/test/uploadInvoice.spec.js --headed

# Run all PRISM tests
npx playwright test tests/PRISM/test/ --headed

# View last HTML report
npx playwright show-report
```

---

## E2E Workflow (verifyUploadedInvoices.spec.js)

### Phase 1 – Upload
1. Login with credentials
2. Navigate to **Upload Invoice** via dashboard sidebar
3. Enter a unique job name (`E2E-{8-digit-timestamp}`, ≤ 15 chars to avoid PRISM truncation)
4. Select PDF files from `tests/temp/` using fileChooser event interception
5. Wait for file names to render in the React UI
6. Click **Upload & Process** button
7. Verify success toast appears

### Phase 2 – Review
1. Navigate to **Review Invoices**
2. Search for the job name in the search bar
3. Click **View** on the job row
4. Wait for files to appear in the details table

### Phase 3 – Validate & Mark Complete
1. Click **Review** on the first file (waits for status to change from "Processing" → "Under Review" via smart-reload loop)
2. Wait for the Invoice validation modal to load
3. Read all 59 extracted fields from the right panel in order
4. Evaluate each field's error state:
   - ✅ `VALID` – field has value and no error message
   - ⏭️ `SKIPPED` – field is empty (`Field is null`)
   - ⏭️ `SKIPPED` – known test-environment errors (e.g., "PO number not found in master")
   - ❌ `MISMATCH` – unexpected critical error (would trigger Mark Rejected)
5. If no critical errors → click **Mark Completed** (green)
6. If critical errors → click **Mark Rejected** (red)

---

## Key Design Decisions

### Job Name Length Limit
PRISM silently truncates job names at ~20 characters. Job names are generated as:
```js
`E2E-${String(Date.now()).slice(-8)}`  // e.g. "E2E-39579549" = 12 chars
```

### File Upload Race Condition Fix
The `fileChooser` listener is registered **before** clicking "Select Files" to avoid the race condition where the dialog opens before Playwright starts listening:
```js
const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
await selectFilesButton.click();
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles(filePaths);
```

### Smart-Reload for Processing Status
PRISM's OCR backend is asynchronous. The Review button stays disabled while files are in "Processing" status. The automation reloads the page every 10 seconds (up to 10 times) to force the UI to sync from the server:
```
Review button still disabled (Processing...). Attempt 1/10. Reloading...
Review button still disabled (Processing...). Attempt 2/10. Reloading...
Success: Review button enabled.
```

### PDF Verification Strategy
Scanned PDFs have no text layer, so `pdf-parse` cannot extract raw text. Instead, the automation reads **PRISM's own extracted field values** directly from the right panel (59 fields across 4 sections) and evaluates their error states. This is the correct approach because PRISM's OCR already did the extraction work.

### Field Sections (59 fields total)
| Section | Fields |
|---|---|
| Invoice Headers | IRN No, PO Number, Invoice No, State Code, Invoice Date, Currency Code, Length Of Invoice, Proforma fields, Site Id fields |
| Delivery Details | SCH State, Delivery Address, GSTIN (OPC), Delivery State |
| Vendor Details | PAN, Vendor Code, Vendor Name, Vendor Address, GSTIN, Vendor State |
| Line Items | Sr No, UOM, Qty, Unit Rate, Line Amount, Bill Amount, Labour/Material/Charges, Asset fields, HSN/SAC, IGST/CGST/UTGST |

---

## Configuration (playwright.config.js)

| Setting | Value | Reason |
|---|---|---|
| `timeout` | 90,000 ms | Global per-action timeout |
| `actionTimeout` | 30,000 ms | PRISM's dev server is slow |
| `expect.timeout` | 30,000 ms | Allows slow OCR loading |
| `retries` | 2 | Handles transient network issues |
| `workers` | 1 | Sequential (safe for shared dev env) |
| `test.setTimeout` | 420,000 ms | 7-min budget for full E2E with OCR |

---

## Known Limitations

| Item | Detail |
|---|---|
| Scanned PDFs | PDF text extraction not possible; PRISM's own extracted values are used instead |
| PO Number validation | "PO number not found in master" is expected in the DEV environment (no master data) — ignored |
| Line Items (multi-item) | Only Line Item 1 fields are read. Line Item 2+ use the same label names in the DOM; only the first match is captured |
| OCR speed | PRISM's DEV backend OCR can take 1–3 minutes per file; automation may reload up to 10× |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Job not found in Review table | Job name truncated by PRISM | Keep job name ≤ 15 chars |
| `fileChooser` timeout | MUI hidden input not triggered | Fallback to direct `setInputFiles` activates automatically |
| `Upload & Process` button not found | Button text changed by PRISM | Update regex in `UploadInvoicePage.js` |
| Review button never enables | OCR backend overloaded | Increase `maxRetries` in `clickReviewOnFirstFile` |
| 0 fields found in right panel | Label selectors don't match DOM | Inspect with browser DevTools and update `FIELD_ORDER` |
