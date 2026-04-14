'use strict';

const { extractTextFromPDF } = require('./pdfReader');

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalise(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Fuzzy match — true if PRISM value and PDF value are "close enough".
 * Handles: exact match, substring, numeric stripping, date separators.
 */
function isMatch(prismVal, pdfVal) {
  if (!prismVal || !pdfVal) return false;
  const p = normalise(prismVal);
  const d = normalise(pdfVal);
  if (p === d) return true;
  if (p.includes(d) || d.includes(p)) return true;
  const numP = parseFloat(p.replace(/[^0-9.]/g, ''));
  const numD = parseFloat(d.replace(/[^0-9.]/g, ''));
  if (!isNaN(numP) && !isNaN(numD) && numP === numD) return true;
  const dateP = p.replace(/[\/\-.]/g, '');
  const dateD = d.replace(/[\/\-.]/g, '');
  if (dateP && dateD && dateP === dateD) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extraction rules — tuned to actual OCR output from PRISM invoices
//
// OCR text sample from "1000043601 -BSLJMC-PT-08.pdf":
//   "GSTN No : 23AAKCB7086Q1ZY"     ← vendor (1st occurrence)
//   "State Code : 23"                ← vendor state (1st occurrence)
//   "BUILTWELL SOLUTIONS LIMITED"    ← vendor name
//   "State Code : 21"                ← OPC/delivery state (2nd occurrence)
//   "GSTN No : 21AAECP2371C1Z1"     ← OPC GSTIN (2nd occurrence)
//   "PT - BROADWAY HEIGHTS ..."      ← delivery location
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_RULES = [

  // ── Invoice Header ─────────────────────────────────────────────────────────
  {
    label: 'Invoice No',
    patterns: [
      /\binvoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\/\-]{2,})/i,
      /\binv\.?\s*(?:no\.?|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\/\-]{2,})/i,
      /\btax\s*invoice\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\/\-]{3,})/i,
    ],
  },
  {
    label: 'Invoice Date',
    patterns: [
      /\binvoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /\binvoice\s*date\s*[:\-]?\s*(\d{1,2}[\s\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\-]\d{2,4})/i,
      /\bdate\s*of\s*invoice\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    ],
  },
  {
    label: 'PO Number',
    patterns: [
      /\bp\.?\s*o\.?\s*(?:no\.?|number|num)?\s*[:\-]?\s*(\d{6,})/i,
      /\bpurchase\s*order\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9]{4,})/i,
    ],
  },
  {
    label: 'IRN No',
    patterns: [
      /\birn\b\s*[:\-]?\s*([a-f0-9]{64})/i,
    ],
  },

  // ── GSTIN ─────────────────────────────────────────────────────────────────
  // OCR format: "GSTN No : 23AAKCB7086Q1ZY" (vendor, 1st) then "21AAECP2371C1Z1" (OPC, 2nd)
  {
    label: 'GSTIN (Vendor as mentioned on INV)',
    patterns: [
      // First GSTIN occurrence = vendor's GSTIN
      /(?:gstn?|gst)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])/i,
    ],
  },
  {
    label: 'GSTIN (OPC as mentioned on INV)',
    patterns: [
      // Skip the first GSTIN, capture the second one
      /(?:gstn?|gst)\s*(?:no\.?|number|#)?\s*[:\-]?\s*[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z][\s\S]{1,400}?(?:gstn?|gst)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])/i,
    ],
  },

  // ── Vendor details ─────────────────────────────────────────────────────────
  {
    label: 'Vendor Name',
    patterns: [
      // All-caps company name ending in LIMITED / PVT LTD / LLP etc.
      /([A-Z][A-Z\s&]{5,50}(?:LIMITED|PVT\.?\s*LTD\.?|LLP|CORPORATION|CORP\.?|INC\.?))/,
    ],
  },
  {
    label: 'PAN (Vendor)',
    patterns: [
      /\bpan\b[^:\n]{0,10}[:\-]?\s*([A-Z]{5}[0-9]{4}[A-Z])\b/i,
      // Fallback: bare PAN anywhere (not immediately followed by more digits)
      /\b([A-Z]{5}[0-9]{4}[A-Z])\b(?!\d)/,
    ],
  },

  // ── State Code ─────────────────────────────────────────────────────────────
  // OCR layout: "State Code : 23" (vendor) THEN "State Code : 21" (OPC/delivery)
  // PRISM stores "State Code" = OPC delivery state = the SECOND occurrence.
  {
    label: 'State Code',
    patterns: [
      // Second "State Code : NN" = OPC state (21 on this invoice)
      /\bstate\s*code\s*[:\-]?\s*\d{2}\b[\s\S]{1,500}?\bstate\s*code\s*[:\-]?\s*(\d{2})\b/i,
      // Fallback: Place of Supply state
      /\bplace\s*of\s*supply\s*(?:state\s*code)?\s*[:\-]?\s*(\d{2})\b/i,
    ],
  },

  // ── Currency / Amounts ─────────────────────────────────────────────────────
  {
    label: 'Currency Code',
    patterns: [
      /\bcurrency\s*[:\-]?\s*(INR|USD|EUR|GBP|AED)\b/i,
    ],
  },
  {
    label: 'Total Bill Amount',
    patterns: [
      /\btotal\s*(?:bill|invoice|taxable)?\s*amount\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /\bgrand\s*total\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /\btotal\s*(?:amount\s*)?(?:payable|due)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ],
  },

  // ── Line Items ─────────────────────────────────────────────────────────────
  {
    label: 'Qty (Invoice)',
    patterns: [
      /\b(?:quantity|qty)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i,
    ],
  },
  {
    label: 'Unit Rate (Invoice)',
    patterns: [
      /\bunit\s*(?:rate|price)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /\brate\s*per\s*unit\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ],
  },

  // ── Tax Codes ──────────────────────────────────────────────────────────────
  {
    label: 'HSN Code as per Invoice',
    patterns: [
      /\bhsn\s*(?:code)?\s*[:\-]?\s*(\d{4,8})\b/i,
    ],
  },
  {
    label: 'SAC Code as per Invoice',
    patterns: [
      /\bsac\s*(?:code)?\s*[:\-]?\s*(\d{4,8})\b/i,
      /\bservice\s*accounting\s*code\s*[:\-]?\s*(\d{4,8})\b/i,
    ],
  },
  {
    label: 'Gst Rate Percent',
    patterns: [
      /\bgst\s*(?:rate|@)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%?/i,
      /\bigst\s*@\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i,
      /(\d{1,2})\s*%\s*(?:gst|igst|tax)/i,
    ],
  },
  {
    label: 'IGST (Services)',
    patterns: [
      /\bigst\s*(?:\(services?\))?\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ],
  },

  // ── Delivery Address ───────────────────────────────────────────────────────
  // OCR actual: "Receiving Location\nPT - BROADWAY HEIGHTS - JHARPADA\n#BROADWAY..."
  {
    label: 'Delivery Address',
    patterns: [
      /(?:receiving\s*(?:name|location)|delivery\s*address|ship\s*to|consignee)\s*[:\-]?\n?\s*(.{10,200}?)(?:\n\n|\bstate\s*code|\bgstn)/is,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts field values from a PDF file.
 * Uses pdf-parse — only works on text-layer PDFs.
 * Returns empty map for scanned PDFs (caller falls back to OCR).
 */
async function extractPDFFields(pdfPath) {
  const fieldMap = new Map();
  let rawText = '';
  try {
    rawText = await extractTextFromPDF(pdfPath);
  } catch (err) {
    console.warn(`[pdfFieldExtractor] Could not read PDF: ${err.message}`);
    return fieldMap;
  }
  if (!rawText || rawText.trim().length < 20) return fieldMap;
  return extractFieldsFromText(rawText);
}

/**
 * Applies all regex field rules to pre-extracted text (from pdf-parse OR OCR).
 * @param {string} rawText
 * @returns {Map<string, string>}
 */
function extractFieldsFromText(rawText) {
  const fieldMap = new Map();
  if (!rawText || rawText.trim().length < 20) {
    console.warn('[pdfFieldExtractor] Text too short to extract fields from.');
    return fieldMap;
  }

  console.log(`[pdfFieldExtractor] Running field extraction on ${rawText.length} chars of text.`);

  for (const rule of FIELD_RULES) {
    for (const pattern of rule.patterns) {
      const match = rawText.match(pattern);
      if (match && match[1] && match[1].trim()) {
        fieldMap.set(rule.label, match[1].trim());
        break;
      }
    }
  }

  console.log(`[pdfFieldExtractor] Extracted ${fieldMap.size} field(s).`);
  return fieldMap;
}

module.exports = { extractPDFFields, extractFieldsFromText, isMatch };
