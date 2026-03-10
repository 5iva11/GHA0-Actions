# Playwright Reporting Pipeline

A **plug-and-play**, zero-cost, fully automated test reporting pipeline built entirely on GitHub-native tools.

```
Tests → GitHub Actions → HTML + JSON reports → gh-pages branch → GitHub Pages Dashboard
```

---

## Features

| Feature | Details |
|---|---|
| **Multi-browser** | Chromium, Firefox, WebKit run in parallel |
| **Dual reports** | HTML (human-readable) + JSON (machine-readable) per run |
| **Run history** | Every run's data is persisted in the `gh-pages` branch |
| **Live dashboard** | Interactive HTML dashboard auto-published to GitHub Pages |
| **Trend sparkline** | Pass-rate chart for the last N runs |
| **Report links** | Direct links to the full HTML report per browser per run |
| **Auto-cleanup** | Oldest runs automatically pruned (configurable, default: 20) |
| **Zero cost** | 100% GitHub Actions + GitHub Pages, no external services |
| **Plug-and-play** | Drop-in for any JS/TS Playwright project; adaptable to Python |

---

## Folder Structure

```
.
├── .github/
│   └── workflows/
│       ├── run-tests.yml          # 1️⃣  Runs tests & stores reports
│       └── publish-report.yml     # 2️⃣  Builds & deploys the dashboard
├── scripts/
│   ├── generate-dashboard.js      # Reads JSON history → HTML dashboard
│   ├── merge-results.js           # Merges per-browser JSON into one file
│   └── cleanup-reports.js         # Prunes oldest run folders
├── tests/
│   └── example.spec.js            # Starter test (replace with yours)
├── package.json
├── playwright.config.js
└── README.md
```

---

## Quick Start

### 1. Clone / fork this repository

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
```

### 2. Install dependencies

```bash
npm install
npx playwright install --with-deps
```

### 3. Set your target URL

Edit `playwright.config.js` → `use.baseURL`, **or** pass it at runtime:

```bash
BASE_URL=https://your-app.com npx playwright test
```

### 4. Write your tests

Add `*.spec.js` / `*.spec.ts` files under `tests/`. The provided
`tests/example.spec.js` is a working starting point.

### 5. Run locally

```bash
# All browsers
npm test

# Single browser
npm run test:chromium
npm run test:firefox
npm run test:webkit

# Open HTML report after run
npm run report
```

---

## GitHub Setup

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "feat: add Playwright reporting pipeline"
git push origin main
```

### Step 2 — Enable GitHub Pages

1. Go to your repository → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Save

> The first dashboard will publish automatically after the first test run completes.

### Step 3 — Grant workflow write permissions

1. **Settings** → **Actions** → **General**
2. Under *Workflow permissions* → select **Read and write permissions**
3. Check **Allow GitHub Actions to create and approve pull requests**
4. Save

### Step 4 — Trigger your first run

- **Automatic**: Push any commit to `main` / `master`
- **Manual**: Go to **Actions** → **Run Playwright Tests** → **Run workflow**

---

## Workflows In Detail

### `run-tests.yml`

```
push / pull_request / schedule / manual trigger
         │
         ▼
Matrix: [chromium, firefox, webkit]  ← run in parallel
         │
         ├─ Install browser
         ├─ Run playwright test --project=<browser>
         ├─ Upload HTML report artifact (retained 30 days)
         └─ Upload JSON results artifact (retained 30 days)
         │
         ▼
commit-reports job (runs after all browsers)
         │
         ├─ Download all artifacts
         ├─ Merge JSONs  (merge-results.js)
         ├─ Checkout gh-pages branch
         ├─ Copy run data → gh-pages/runs/<run_id>/
         ├─ Cleanup old runs  (cleanup-reports.js)
         └─ Push → gh-pages, then trigger publish-report.yml
```

### `publish-report.yml`

```
workflow_dispatch (called by run-tests.yml)
         │
         ▼
Checkout main + gh-pages
         │
generate-dashboard.js  (reads gh-pages/runs/*/results.json)
         │
Copy HTML reports into output
         │
actions/upload-pages-artifact → actions/deploy-pages
         │
         ▼
https://<org>.github.io/<repo>/
```

---

## Dashboard

The dashboard at `https://<org>.github.io/<repo>/` shows:

- **Summary cards**: Total Runs, Total Tests, Passed, Failed, Pass Rate
- **Sparkline chart**: pass-rate trend for the last 20 runs with hover tooltips
- **Run history table**: timestamp, branch, commit, actor, per-browser pass/fail counts
- **Report links**: click any browser name to open the full Playwright HTML report

---

## Configuration Reference

### `playwright.config.js`

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `https://playwright.dev` | Target application URL |
| `WORKERS` | `1` (CI) / auto (local) | Parallel worker count |
| `RETRIES` | `2` (CI) / `0` (local) | Retry count on failure |
| `CI` | set by GitHub automatically | Enables CI mode |

### Cleanup (in workflow env or local)

| Variable | Default | Description |
|---|---|---|
| `MAX_RUNS` | `20` | Maximum run folders to retain |
| `PAGES_DIR` | `gh-pages-dir` | Path to gh-pages worktree |

### Dashboard generation

| Variable | Default | Description |
|---|---|---|
| `RUNS_DIR` | `gh-pages-src/runs` | Path to run history |
| `OUTPUT_DIR` | `dashboard-output` | Output directory for dashboard |
| `MAX_RUNS` | `20` | Runs to display in dashboard |
| `DASHBOARD_TITLE` | `Playwright Test Dashboard` | Title shown in the UI |

---

## Manual Dashboard Generation (local)

```bash
# Point RUNS_DIR at your local gh-pages checkout
RUNS_DIR=path/to/gh-pages/runs \
OUTPUT_DIR=dashboard-output \
node scripts/generate-dashboard.js

# Open it
open dashboard-output/index.html   # macOS
start dashboard-output/index.html  # Windows
```

---

## Adapting to Other Frameworks

### Python Playwright (`pytest-playwright`)

1. Replace `package.json` / `playwright.config.js` with your `pytest` setup.
2. In `run-tests.yml`, replace the Node setup + `npx playwright test` step with:

```yaml
- uses: actions/setup-python@v5
  with: { python-version: '3.12' }

- run: pip install pytest pytest-playwright

- run: playwright install --with-deps ${{ matrix.browser }}

- run: |
    pytest tests/ \
      --browser ${{ matrix.browser }} \
      --json-report --json-report-file=test-results/results.json \
      --html=playwright-report/index.html --self-contained-html
```

3. The `generate-dashboard.js` script reads the standard JSON format.
   For `pytest-json-report`, add a thin adapter in `merge-results.js`
   to map its schema to the Playwright schema (totalPassed / totalFailed fields).

### Java / C# / other languages

Follow the same pattern: output a `results.json` with at minimum the
fields `numTotalTests`, `numPassedTests`, `numFailedTests`, then the
dashboard will render correctly without any further changes.

---

## Security Notes

- Workflows use **pinned action versions** (`@v4`) for supply-chain safety.
- The `gh-pages` push is isolated to the `commit-reports` job with
  `permissions: contents: write` scoped only to that job.
- No secrets are required. No external services are called.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard shows "No runs found" | Ensure `run-tests.yml` completed at least once and pushed to `gh-pages` |
| GitHub Pages shows 404 | Check **Settings → Pages → Source** is set to **GitHub Actions** |
| `git push` fails in workflow | Enable **Read and write permissions** in Settings → Actions → General |
| Browser install fails | Run `npx playwright install --with-deps` locally to verify |
| JSON parse error in dashboard | Check `results.json` in the `gh-pages` branch for the failing run |

---

## License

MIT — free to use and adapt for any project.


git init
git add .
git commit -m "feat: Playwright Python pipeline"
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main