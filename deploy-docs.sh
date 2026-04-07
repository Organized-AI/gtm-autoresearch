#!/bin/bash
# ============================================================
# deploy-docs.sh
# Cloudflare Pages deploy for gtm-autoresearch docs
# Account: Jordan@projectnewsense.com (691fe25d377abac03627d6a88d3eeac9)
# Project: gtm-autoresearch-docs → gtm-autoresearch-docs.pages.dev
# ============================================================

set -e

ACCOUNT_ID="691fe25d377abac03627d6a88d3eeac9"
PROJECT_NAME="gtm-autoresearch-docs"
DOCS_DIR="./docs"
BRANCH="feature/finetune-pipeline"

echo "→ Cloudflare Account: $ACCOUNT_ID"
echo "→ Project: $PROJECT_NAME"
echo "→ Docs dir: $DOCS_DIR"
echo ""

# Step 1: Check wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "Installing wrangler..."
  npm install -g wrangler
fi

echo "✓ wrangler $(wrangler --version)"

# Step 2: Create Pages project (only needed once — safe to re-run, will skip if exists)
echo ""
echo "→ Creating Pages project (skips if already exists)..."
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID \
  wrangler pages project create $PROJECT_NAME \
  --production-branch=main \
  --compatibility-date=2026-04-07 2>/dev/null || echo "  (project already exists — continuing)"

# Step 3: Deploy docs/ to production
echo ""
echo "→ Deploying docs/ to production..."
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID \
  wrangler pages deploy $DOCS_DIR \
  --project-name=$PROJECT_NAME \
  --branch=main \
  --commit-message="feat: finetune pipeline docs" \
  --commit-dirty=true

echo ""
echo "✓ Deployed to: https://$PROJECT_NAME.pages.dev"

# Step 4: Also deploy preview on feature branch
echo ""
echo "→ Deploying preview on branch: $BRANCH..."
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID \
  wrangler pages deploy $DOCS_DIR \
  --project-name=$PROJECT_NAME \
  --branch=$BRANCH \
  --commit-message="preview: finetune-pipeline branch docs" \
  --commit-dirty=true

echo ""
echo "✓ Preview: https://feature-finetune-pipeline.$PROJECT_NAME.pages.dev"
echo ""
echo "Done."
