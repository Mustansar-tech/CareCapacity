#!/bin/bash
set -e
npm run build
npx playwright install chromium --with-deps
