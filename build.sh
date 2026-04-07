#!/bin/bash
set -e
npm run build
# Install Playwright browser for People Planner automation.
# Non-fatal: if the download fails (e.g. network limits on the build host),
# the main app still works; only the automation feature will be unavailable.
npx playwright install chromium || echo "Warning: Playwright Chromium install failed — automation features may be unavailable."
