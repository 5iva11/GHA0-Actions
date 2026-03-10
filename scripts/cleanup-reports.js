#!/usr/bin/env node
/**
 * cleanup-reports.js
 *
 * Removes the oldest run folders from the gh-pages branch to keep
 * the repository lightweight.  Configurable via environment variables
 * so the same script works locally and inside GitHub Actions.
 *
 * Environment variables:
 *   MAX_RUNS   Maximum number of run folders to keep  (default: 20)
 *   PAGES_DIR  Root of the gh-pages working tree       (default: gh-pages-dir)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_RUNS  = parseInt(process.env.MAX_RUNS  || '20', 10);
const PAGES_DIR = process.env.PAGES_DIR || path.join(__dirname, '..', 'gh-pages-dir');
const RUNS_DIR  = path.join(PAGES_DIR, 'runs');

if (!fs.existsSync(RUNS_DIR)) {
  console.log(`[cleanup] Runs directory not found: ${RUNS_DIR}. Nothing to clean up.`);
  process.exit(0);
}

// Run IDs are numeric GitHub Action run IDs — sort ascending (oldest first)
const allRuns = fs.readdirSync(RUNS_DIR)
  .filter(d => fs.statSync(path.join(RUNS_DIR, d)).isDirectory())
  .sort();                      // lexicographic sort works for numeric IDs

const excess = allRuns.length - MAX_RUNS;

if (excess <= 0) {
  console.log(`[cleanup] ${allRuns.length}/${MAX_RUNS} runs kept — no cleanup needed.`);
  process.exit(0);
}

const toRemove = allRuns.slice(0, excess);   // oldest N folders

for (const runId of toRemove) {
  const dirPath = path.join(RUNS_DIR, runId);
  fs.rmSync(dirPath, { recursive: true, force: true });
  console.log(`[cleanup] Removed old run: ${runId}`);
}

console.log(`[cleanup] Removed ${toRemove.length} run(s). Kept ${MAX_RUNS}.`);
