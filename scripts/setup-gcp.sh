#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Gogobot — GCP Setup Script
# ============================================================
# This script automates the GCP infrastructure setup for Gogobot.
# Run it once to create the platform project, service account,
# folder, and all required permissions.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Access to a GCP Organization
#   - A billing account you can link projects to
#   - For folder creation: Organization Admin or Folder Creator role
#
# Usage:
#   ./scripts/setup-gcp.sh
#
# The script will prompt for required values and generate a .env
# file you can copy to .env.local.
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- Preflight checks ----
command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install"
command -v jq >/dev/null 2>&1 || warn "jq not found — some output formatting may be limited. Install with: brew install jq"

echo ""
echo "========================================"
echo "  Gogobot — GCP Setup"
echo "========================================"
echo ""
echo "This script will:"
echo "  1. Create a GCP project for the Gogobot platform"
echo "  2. Enable required APIs"
echo "  3. Set up Firebase (Auth + Firestore)"
echo "  4. Create a service account with scoped permissions"
echo "  5. Create an isolated folder for user projects"
echo "  6. Generate a .env file with all configuration"
echo ""

# ---- Gather inputs ----
read -rp "GCP Organization ID (numeric, from 'gcloud organizations list'): " ORG_ID
[[ -z "$ORG_ID" ]] && error "Organization ID is required"

read -rp "Billing Account ID (from 'gcloud billing accounts list'): " BILLING_ACCOUNT
[[ -z "$BILLING_ACCOUNT" ]] && error "Billing Account ID is required"

read -rp "Platform project ID [gogobot-platform]: " PROJECT
PROJECT=${PROJECT:-gogobot-platform}

read -rp "GCP region [us-central1]: " REGION
REGION=${REGION:-us-central1}

SA_NAME="gogobot-admin"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo ""
info "Configuration:"
echo "  Organization:    $ORG_ID"
echo "  Billing Account: $BILLING_ACCOUNT"
echo "  Platform Project: $PROJECT"
echo "  Region:          $REGION"
echo "  Service Account: $SA_EMAIL"
echo ""
read -rp "Continue? [Y/n] " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && exit 0

# ---- Step 1: Create platform project ----
info "Step 1/7: Creating platform project '$PROJECT'..."
if gcloud projects describe "$PROJECT" &>/dev/null; then
  ok "Project '$PROJECT' already exists"
else
  gcloud projects create "$PROJECT" \
    --name="Gogobot Platform" \
    --organization="$ORG_ID" 2>/dev/null
  ok "Created project '$PROJECT'"
fi

info "Linking billing account..."
gcloud billing projects link "$PROJECT" \
  --billing-account="$BILLING_ACCOUNT" 2>/dev/null
ok "Billing linked"

# ---- Step 2: Enable platform APIs ----
info "Step 2/7: Enabling APIs on platform project (this takes a minute)..."
APIS=(
  aiplatform.googleapis.com
  firestore.googleapis.com
  identitytoolkit.googleapis.com
  cloudbilling.googleapis.com
  serviceusage.googleapis.com
  cloudresourcemanager.googleapis.com
  firebase.googleapis.com
  firebasehosting.googleapis.com
)
for api in "${APIS[@]}"; do
  gcloud services enable "$api" --project="$PROJECT" 2>/dev/null &
done
wait
ok "All APIs enabled"

# ---- Step 3: Set up Firestore ----
info "Step 3/7: Creating Firestore database..."
if gcloud firestore databases describe --project="$PROJECT" &>/dev/null; then
  ok "Firestore database already exists"
else
  gcloud firestore databases create \
    --project="$PROJECT" \
    --location="$REGION" 2>/dev/null
  ok "Firestore database created in $REGION"
fi

# ---- Step 4: Create service account ----
info "Step 4/7: Creating service account..."
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
  ok "Service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Gogobot Admin SA" \
    --project="$PROJECT" 2>/dev/null
  ok "Created service account $SA_EMAIL"
fi

info "Granting platform project roles..."
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/owner" \
  --condition=None \
  --quiet 2>/dev/null
ok "SA has owner role on platform project"

KEY_FILE="gogobot-sa-key.json"
if [[ -f "$KEY_FILE" ]]; then
  warn "Key file '$KEY_FILE' already exists — using existing key"
else
  info "Exporting service account key..."
  gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" 2>/dev/null
  ok "Key exported to $KEY_FILE"
fi

# ---- Step 5: Create Gogobot folder ----
info "Step 5/7: Creating Gogobot folder in organization..."
EXISTING_FOLDER=$(gcloud resource-manager folders list \
  --organization="$ORG_ID" \
  --filter="displayName='Gogobot Projects'" \
  --format="value(name)" 2>/dev/null | head -1)

if [[ -n "$EXISTING_FOLDER" ]]; then
  FOLDER_ID=$(echo "$EXISTING_FOLDER" | sed 's|folders/||')
  ok "Folder already exists: $FOLDER_ID"
else
  FOLDER_OUTPUT=$(gcloud resource-manager folders create \
    --display-name="Gogobot Projects" \
    --organization="$ORG_ID" \
    --format="value(name)" 2>/dev/null)
  FOLDER_ID=$(echo "$FOLDER_OUTPUT" | sed 's|folders/||')
  ok "Created folder: $FOLDER_ID"
fi

# ---- Step 6: Grant folder-scoped roles ----
info "Step 6/7: Granting folder-scoped roles to service account..."
FOLDER_ROLES=(
  roles/resourcemanager.projectCreator
  roles/resourcemanager.projectDeleter
  roles/resourcemanager.folderCreator
  roles/firebase.admin
  roles/editor
)
for role in "${FOLDER_ROLES[@]}"; do
  gcloud resource-manager folders add-iam-policy-binding "$FOLDER_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --quiet 2>/dev/null &
done
wait
ok "All folder roles granted"

info "Granting billing.user on billing account..."
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/billing.user" \
  --quiet 2>/dev/null
ok "Billing permission granted"

# ---- Step 7: Generate .env file ----
info "Step 7/7: Generating .env file..."

# Read the SA key as a single-line JSON string
SA_KEY_JSON=$(cat "$KEY_FILE" | tr -d '\n')

cat > .env.generated <<EOF
# Generated by setup-gcp.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# Copy this to .env.local and add your Firebase client config.

# Firebase Client (get these from Firebase Console → Project Settings → Your apps)
# https://console.firebase.google.com/project/${PROJECT}/settings/general
NEXT_PUBLIC_FIREBASE_API_KEY=FILL_IN_FROM_FIREBASE_CONSOLE
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${PROJECT}.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${PROJECT}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${PROJECT}.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=FILL_IN_FROM_FIREBASE_CONSOLE
NEXT_PUBLIC_FIREBASE_APP_ID=FILL_IN_FROM_FIREBASE_CONSOLE

# Firebase Admin (server-side only)
FIREBASE_ADMIN_KEY=${SA_KEY_JSON}

# Google Cloud Platform
GOOGLE_CLOUD_PROJECT_ID=${PROJECT}
GOOGLE_CLOUD_LOCATION=${REGION}

# GCP Isolation
GCP_BILLING_ACCOUNT_ID=${BILLING_ACCOUNT}
GCP_FOLDER_ID=${FOLDER_ID}

# Application
NEXT_PUBLIC_BASE_URL=http://localhost:3000
EOF

ok "Generated .env.generated"

echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "What's left:"
echo ""
echo "  1. Add Firebase to the project (if not done):"
echo "     firebase projects:addfirebase $PROJECT"
echo ""
echo "  2. Enable Email/Password auth in Firebase Console:"
echo "     https://console.firebase.google.com/project/${PROJECT}/authentication/providers"
echo ""
echo "  3. Add a web app in Firebase Console to get client config:"
echo "     https://console.firebase.google.com/project/${PROJECT}/settings/general"
echo "     Then fill in the NEXT_PUBLIC_FIREBASE_* values in .env.generated"
echo ""
echo "  4. Copy the env file:"
echo "     cp .env.generated .env.local"
echo ""
echo "  5. Run Gogobot:"
echo "     npm install && npm run dev"
echo "     # or: docker compose up --build"
echo ""
echo "  Service account key saved to: $KEY_FILE"
echo "  Keep this file secure and DO NOT commit it to git."
echo ""
