'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Supported MIME extensions for the PRISM upload form.
 * Extend this list if the application supports additional formats.
 */
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png']);

/**
 * Dynamically loads all supported files from the given directory.
 *
 * @param {string} [folder] - Absolute path to the directory. Defaults to
 *   <projectRoot>/tests/files/
 * @param {{ extensions?: string[], maxFiles?: number }} [options]
 * @returns {string[]} Sorted array of absolute file paths.
 * @throws {Error} If the directory is empty or no supported files are found.
 */
function loadFilesFromFolder(folder, options = {}) {
  const {
    extensions = [...SUPPORTED_EXTENSIONS],
    maxFiles = Infinity,
  } = options;

  const dir = folder ?? path.resolve(__dirname, '..', '..', 'files');

  if (!fs.existsSync(dir)) {
    throw new Error(`File directory not found: ${dir}`);
  }

  const allowedExts = new Set(extensions.map((e) => e.toLowerCase()));

  const files = fs
    .readdirSync(dir)
    .filter((name) => allowedExts.has(path.extname(name).toLowerCase()))
    .sort()                                          // deterministic order
    .slice(0, maxFiles)
    .map((name) => path.resolve(dir, name));

  if (files.length === 0) {
    throw new Error(
      `No supported files found in: ${dir}\n` +
      `Supported extensions: ${[...allowedExts].join(', ')}`
    );
  }

  console.log(`[fileHelper] Loaded ${files.length} file(s) from: ${dir}`);
  return files;
}

module.exports = { loadFilesFromFolder };
