#!/usr/bin/env node
/**
 * generate-dashboard.js
 *
 * Reads every run stored in RUNS_DIR, builds a summary, then writes
 * a fully self-contained interactive HTML dashboard to OUTPUT_DIR.
 *
 * Environment variables (all optional — sensible defaults provided):
 *   RUNS_DIR         Path that contains per-run folders       (default: gh-pages-src/runs)
 *   OUTPUT_DIR       Where to write index.html + assets        (default: dashboard-output)
 *   MAX_RUNS         How many recent runs to include           (default: 20)
 *   DASHBOARD_TITLE  Title shown in the page header            (default: Playwright Test Dashboard)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const RUNS_DIR        = process.env.RUNS_DIR        || path.join(__dirname, '..', 'gh-pages-src', 'runs');
const OUTPUT_DIR      = process.env.OUTPUT_DIR       || path.join(__dirname, '..', 'dashboard-output');
const MAX_RUNS        = parseInt(process.env.MAX_RUNS || '20', 10);
const DASHBOARD_TITLE = process.env.DASHBOARD_TITLE  || 'Playwright Test Dashboard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses one JSON results file and returns a structured summary.
 *
 * Supported formats (auto-detected):
 *   1. pytest-json-report  (Python pytest-playwright)  — has a top-level "summary" key
 *   2. Playwright JS JSON reporter                      — has a top-level "suites" key
 */
function parseResults(resultsJson, meta) {
  let total = 0, passed = 0, failed = 0, skipped = 0, flaky = 0;

  // ── Format 1 : pytest-json-report (Python) ───────────────────────────────
  if (resultsJson.summary) {
    const s = resultsJson.summary;
    passed  =  s.passed              || 0;
    failed  = (s.failed  || 0) + (s.error    || 0);
    skipped = (s.skipped || 0) + (s.xfailed  || 0);
    total   =  s.total   || (passed + failed + skipped);
  }
  // ── Format 2 : Playwright JS reporter (legacy / JS projects) ─────────────
  else {
    const suites = resultsJson.suites || [];

    function walkSuite(suite) {
      for (const spec of (suite.specs || [])) {
        for (const test of (spec.tests || [])) {
          total++;
          const status = test.status;   // 'expected' | 'unexpected' | 'flaky' | 'skipped'
          if      (status === 'expected')   passed++;
          else if (status === 'unexpected') failed++;
          else if (status === 'flaky')      { flaky++; passed++; }
          else if (status === 'skipped')    skipped++;
        }
      }
      for (const child of (suite.suites || [])) walkSuite(child);
    }

    for (const s of suites) walkSuite(s);

    // Jest / other runners expose top-level numXxx fields
    if (total === 0 && resultsJson.numTotalTests !== undefined) {
      total   = resultsJson.numTotalTests   || 0;
      passed  = resultsJson.numPassedTests  || 0;
      failed  = resultsJson.numFailedTests  || 0;
      skipped = resultsJson.numPendingTests || 0;
    }
  }

  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  return {
    run_id:    meta.run_id,
    timestamp: meta.timestamp,
    branch:    meta.branch    || '',
    commit:    (meta.commit   || '').slice(0, 7),
    actor:     meta.actor     || '',
    event:     meta.event     || '',
    total, passed, failed, skipped, flaky,
    pass_rate: parseFloat(rate),
  };
}

/**
 * Walks RUNS_DIR and collects the N most-recent run summaries.
 */
function collectRuns() {
  if (!fs.existsSync(RUNS_DIR)) {
    console.warn(`[dashboard] RUNS_DIR not found: ${RUNS_DIR}. Generating empty dashboard.`);
    return [];
  }

  const runDirs = fs.readdirSync(RUNS_DIR)
    .filter(d => fs.statSync(path.join(RUNS_DIR, d)).isDirectory())
    .sort()                   // run IDs are numeric → ascending
    .reverse()                // newest first
    .slice(0, MAX_RUNS);

  const summaries = [];

  for (const runId of runDirs) {
    const runPath     = path.join(RUNS_DIR, runId);
    const metaPath    = path.join(runPath, 'meta.json');
    const resultsPath = path.join(runPath, 'results.json');

    if (!fs.existsSync(metaPath) || !fs.existsSync(resultsPath)) {
      console.warn(`[dashboard] Skipping incomplete run folder: ${runId}`);
      continue;
    }

    try {
      const meta    = JSON.parse(fs.readFileSync(metaPath,    'utf8'));
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      summaries.push(parseResults(results, meta));
    } catch (err) {
      console.error(`[dashboard] Error parsing run ${runId}:`, err.message);
    }
  }

  return summaries;   // newest first
}

/**
 * Returns all available report links for a given run.
 *
 * Supports:
 *   • Python pytest-html  →  runs/<id>/report/report.html  (single combined report)
 *   • Playwright JS       →  runs/<id>/report-<browser>/index.html  (per-browser)
 */
function detectReportLinks(runId) {
  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return [];

  const links = [];

  // Python: single pytest-html report folder
  if (fs.existsSync(path.join(runPath, 'report'))) {
    links.push({ label: 'report', href: `runs/${runId}/report/report.html` });
  }

  // JS Playwright: per-browser report-<browser>/ folders
  for (const b of ['chromium', 'firefox', 'webkit']) {
    if (fs.existsSync(path.join(runPath, `report-${b}`))) {
      links.push({ label: b, href: `runs/${runId}/report-${b}/index.html` });
    }
  }

  return links;
}

// ─── Dashboard HTML template ─────────────────────────────────────────────────

function buildHTML(runs, title) {
  const now = new Date().toISOString();

  // Aggregate totals
  const totalRuns   = runs.length;
  const totalPassed = runs.reduce((s, r) => s + r.passed, 0);
  const totalFailed = runs.reduce((s, r) => s + r.failed, 0);
  const totalTests  = runs.reduce((s, r) => s + r.total,  0);
  const overallRate = totalTests > 0
    ? ((totalPassed / totalTests) * 100).toFixed(1)
    : '0.0';

  // Sparkline data — pass rate for last 20 runs (oldest→newest so chart reads L→R)
  const sparkData = [...runs].reverse().map(r => r.pass_rate);

  // Summary cards
  const cardClass = (val) => val === 0 ? 'card-neutral' : val > 0 ? 'card-danger' : 'card-success';

  // Table rows
  const tableRows = runs.map(r => {
    const links = detectReportLinks(r.run_id);
    const reportLinks = links.length
      ? links.map(l =>
          `<a href="${l.href}" class="report-link" target="_blank">${l.label}</a>`
        ).join(' ')
      : '<span class="no-report">—</span>';

    const rateClass = r.pass_rate >= 90 ? 'rate-good' :
                      r.pass_rate >= 70 ? 'rate-warn' : 'rate-bad';

    const rowClass  = r.failed > 0 ? 'row-fail' : 'row-pass';

    return `
      <tr class="${rowClass}">
        <td class="mono">${r.run_id}</td>
        <td>${formatDate(r.timestamp)}</td>
        <td class="mono branch">${r.branch}</td>
        <td class="mono commit">${r.commit}</td>
        <td>${r.actor}</td>
        <td class="num">${r.total}</td>
        <td class="num passed">${r.passed}</td>
        <td class="num failed">${r.failed}</td>
        <td class="num skipped">${r.skipped}</td>
        <td class="num ${rateClass}">${r.pass_rate}%</td>
        <td>${reportLinks}</td>
      </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>
    /* ── Reset & base ───────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:         #0d1117;
      --surface:    #161b22;
      --border:     #30363d;
      --text:       #e6edf3;
      --muted:      #8b949e;
      --green:      #3fb950;
      --red:        #f85149;
      --yellow:     #d29922;
      --blue:       #58a6ff;
      --purple:     #bc8cff;
      --font:       'Inter', system-ui, -apple-system, sans-serif;
      --radius:     8px;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 14px;
      line-height: 1.5;
      padding: 24px 32px 64px;
    }

    /* ── Header ─────────────────────────────────────────── */
    .header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 28px;
    }
    .header h1 { font-size: 22px; font-weight: 600; }
    .header .subtitle { color: var(--muted); font-size: 13px; }

    /* ── Summary cards ───────────────────────────────────── */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 20px;
    }
    .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
    .card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
    .card-good  .value { color: var(--green); }
    .card-danger .value { color: var(--red); }
    .card-warn  .value { color: var(--yellow); }
    .card-blue  .value { color: var(--blue); }
    .card-neutral .value { color: var(--text); }

    /* ── Sparkline section ───────────────────────────────── */
    .chart-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 24px;
      margin-bottom: 28px;
    }
    .chart-section h2 { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
    #sparkline-canvas { width: 100%; height: 80px; display: block; }

    /* ── Table ───────────────────────────────────────────── */
    .table-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: auto;
    }
    .table-section h2 {
      font-size: 15px; font-weight: 600;
      padding: 16px 20px; border-bottom: 1px solid var(--border);
    }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      text-align: left;
      padding: 10px 14px;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .04em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    tbody tr { border-bottom: 1px solid var(--border); transition: background .15s; }
    tbody tr:hover { background: #1c2128; }
    tbody tr:last-child { border-bottom: none; }
    td { padding: 10px 14px; white-space: nowrap; }
    .num  { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; }
    .branch { color: var(--purple); }
    .commit { color: var(--blue); }
    .passed  { color: var(--green); }
    .failed  { color: var(--red); }
    .skipped { color: var(--muted); }
    .rate-good { color: var(--green); font-weight: 600; }
    .rate-warn { color: var(--yellow); font-weight: 600; }
    .rate-bad  { color: var(--red);    font-weight: 600; }
    .row-fail td:first-child { border-left: 3px solid var(--red); }
    .row-pass td:first-child { border-left: 3px solid var(--green); }
    .report-link {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      background: #1f6feb22;
      border: 1px solid #1f6feb66;
      color: var(--blue);
      text-decoration: none;
      font-size: 12px;
      margin-right: 4px;
    }
    .report-link:hover { background: #1f6feb44; }
    .no-report { color: var(--muted); }

    /* ── Footer ─────────────────────────────────────────── */
    .footer {
      margin-top: 32px;
      font-size: 12px;
      color: var(--muted);
      text-align: center;
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>${escHtml(title)}</h1>
    <span class="subtitle">Last updated: ${formatDate(now)} UTC</span>
  </div>

  <!-- ── Summary cards ─────────────────────────────────── -->
  <div class="cards">
    <div class="card card-blue">
      <div class="label">Total Runs</div>
      <div class="value">${totalRuns}</div>
    </div>
    <div class="card card-neutral">
      <div class="label">Total Tests</div>
      <div class="value">${totalTests}</div>
    </div>
    <div class="card card-good">
      <div class="label">Passed</div>
      <div class="value">${totalPassed}</div>
    </div>
    <div class="card card-danger">
      <div class="label">Failed</div>
      <div class="value">${totalFailed}</div>
    </div>
    <div class="card ${parseFloat(overallRate) >= 90 ? 'card-good' : parseFloat(overallRate) >= 70 ? 'card-warn' : 'card-danger'}">
      <div class="label">Pass Rate</div>
      <div class="value">${overallRate}%</div>
    </div>
  </div>

  <!-- ── Sparkline chart ──────────────────────────────────── -->
  <div class="chart-section">
    <h2>Pass Rate Trend (last ${MAX_RUNS} runs)</h2>
    <canvas id="sparkline-canvas"></canvas>
  </div>

  <!-- ── Runs table ──────────────────────────────────────── -->
  <div class="table-section">
    <h2>Run History</h2>
    <table>
      <thead>
        <tr>
          <th>Run ID</th>
          <th>Timestamp</th>
          <th>Branch</th>
          <th>Commit</th>
          <th>Actor</th>
          <th>Total</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Skipped</th>
          <th>Pass Rate</th>
          <th>Reports</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:32px">No runs found yet.</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Generated by <strong>generate-dashboard.js</strong> &bull; ${escHtml(title)}
  </div>

  <!-- ── Inline sparkline renderer (no external deps) ─────── -->
  <script>
    (function () {
      const data = ${JSON.stringify(sparkData)};
      const canvas = document.getElementById('sparkline-canvas');
      if (!canvas || !data.length) return;

      const dpr = window.devicePixelRatio || 1;
      const W   = canvas.offsetWidth  || 800;
      const H   = canvas.offsetHeight || 80;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const PAD   = { top: 12, bottom: 20, left: 40, right: 16 };
      const chartW = W - PAD.left - PAD.right;
      const chartH = H - PAD.top  - PAD.bottom;

      const min = 0, max = 100;
      const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;

      const toX = i => PAD.left + i * xStep;
      const toY = v => PAD.top + chartH - ((v - min) / (max - min)) * chartH;

      // ── Gradient fill ─────────────────────────────────────
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
      grad.addColorStop(0,   'rgba(63, 185, 80, 0.35)');
      grad.addColorStop(1,   'rgba(63, 185, 80, 0.00)');

      ctx.beginPath();
      ctx.moveTo(toX(0), toY(data[0]));
      for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
      ctx.lineTo(toX(data.length - 1), PAD.top + chartH);
      ctx.lineTo(toX(0), PAD.top + chartH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Line ─────────────────────────────────────────────
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(data[0]));
      for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.stroke();

      // ── Data-point dots ───────────────────────────────────
      data.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(toX(i), toY(v), 3, 0, Math.PI * 2);
        ctx.fillStyle = v >= 90 ? '#3fb950' : v >= 70 ? '#d29922' : '#f85149';
        ctx.fill();
      });

      // ── Y-axis labels ─────────────────────────────────────
      ctx.fillStyle   = '#8b949e';
      ctx.font        = '11px Inter, system-ui, sans-serif';
      ctx.textAlign   = 'right';
      ctx.textBaseline = 'middle';
      [0, 50, 100].forEach(v => {
        ctx.fillText(v + '%', PAD.left - 6, toY(v));
        ctx.beginPath();
        ctx.moveTo(PAD.left, toY(v));
        ctx.lineTo(PAD.left + chartW, toY(v));
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth   = 0.5;
        ctx.stroke();
      });

      // ── Tooltip on hover ──────────────────────────────────
      canvas.addEventListener('mousemove', function (e) {
        const rect = canvas.getBoundingClientRect();
        const mx   = e.clientX - rect.left;
        let closest = 0;
        let closestDist = Infinity;
        data.forEach((_, i) => {
          const d = Math.abs(toX(i) - mx);
          if (d < closestDist) { closestDist = d; closest = i; }
        });

        // Redraw
        ctx.clearRect(0, 0, W, H);

        // Gradient fill (redraw)
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(data[0]));
        for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
        ctx.lineTo(toX(data.length - 1), PAD.top + chartH);
        ctx.lineTo(toX(0), PAD.top + chartH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(toX(0), toY(data[0]));
        for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
        ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

        data.forEach((v, i) => {
          ctx.beginPath();
          ctx.arc(toX(i), toY(v), i === closest ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = v >= 90 ? '#3fb950' : v >= 70 ? '#d29922' : '#f85149';
          ctx.fill();
        });

        [0, 50, 100].forEach(v => {
          ctx.fillStyle = '#8b949e'; ctx.font = '11px Inter, system-ui, sans-serif';
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(v + '%', PAD.left - 6, toY(v));
          ctx.beginPath(); ctx.moveTo(PAD.left, toY(v)); ctx.lineTo(PAD.left + chartW, toY(v));
          ctx.strokeStyle = '#30363d'; ctx.lineWidth = 0.5; ctx.stroke();
        });

        // Tooltip box
        const tx = toX(closest);
        const ty = toY(data[closest]);
        const label = data[closest].toFixed(1) + '%';
        ctx.font = 'bold 12px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 16;
        const th = 24;
        let bx = tx - tw / 2;
        if (bx < PAD.left)          bx = PAD.left;
        if (bx + tw > W - PAD.right) bx = W - PAD.right - tw;
        const by = ty - th - 8;
        ctx.fillStyle   = '#161b22';
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, th, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + tw / 2, by + th / 2);
      });
    })();
  </script>
</body>
</html>`;
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'UTC', hour12: false,
    }) + ' UTC';
  } catch { return iso; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('[dashboard] Starting dashboard generation…');
  console.log(`[dashboard]   RUNS_DIR   = ${RUNS_DIR}`);
  console.log(`[dashboard]   OUTPUT_DIR = ${OUTPUT_DIR}`);
  console.log(`[dashboard]   MAX_RUNS   = ${MAX_RUNS}`);

  const runs = collectRuns();
  console.log(`[dashboard] Found ${runs.length} valid run(s).`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const html = buildHTML(runs, DASHBOARD_TITLE);
  const outFile = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(outFile, html, 'utf8');
  console.log(`[dashboard] Dashboard written to: ${outFile}`);

  // Also write a machine-readable summary JSON for external consumers
  const summaryFile = path.join(OUTPUT_DIR, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({ generated: new Date().toISOString(), runs }, null, 2), 'utf8');
  console.log(`[dashboard] Summary JSON written to: ${summaryFile}`);
}

main();
