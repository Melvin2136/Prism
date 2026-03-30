'use strict';

const fs = require('fs');
const pdf = require('pdf-parse');

/**
 * Extracts all raw text from a PDF file using pdf-parse.
 * @param {string} pdfPath - Absolute path to the PDF file
 * @returns {Promise<string>} The extracted text content
 */
async function extractTextFromPDF(pdfPath) {
    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found at: ${pdfPath}`);
        }
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (e) {
        console.error('Error extracting PDF text:', e);
        return '';
    }
}

module.exports = { extractTextFromPDF };
