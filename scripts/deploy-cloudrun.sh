#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Gogobot — Deploy to Cloud Run
# ============================================================
# Builds the Docker image via Cloud Build and deploys to Cloud Run.
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - .env.local exists with all required values
#   - GCP setup completed (run scripts/setup-gcp.sh first)
#
# Usage:
#   ./scripts/deploy-cloudrun.sh
#   ./scripts/deploy-cloudrun.sh --project my-project --region us-central1
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- Parse arguments ----
PROJECT=""
REGION="us-central1"
SERVICE_NAME="gogobot"
ENV_FILE=".env.local"

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) error "Unknown option: $1" ;;
  esac
done

# ---- Load env file (safe parser — handles unquoted JSON values) ----
[[ -f "$ENV_FILE" ]] || error "$ENV_FILE not found. Create it from .env.example first."

# Parse KEY=VALUE lines safely (handles JSON with spaces, commas, etc.)
get_env() {
  local key="$1"
  while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    local k="${line%%=*}"
    k="$(echo "$k" | xargs)"
    if [[ "$k" == "$key" ]]; then
      echo "${line#*=}"
      return
    fi
  done < "$ENV_FILE"
}

NEXT_PUBLIC_FIREBASE_API_KEY="$(get_env NEXT_PUBLIC_FIREBASE_API_KEY)"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$(get_env NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="$(get_env NEXT_PUBLIC_FIREBASE_PROJECT_ID)"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="$(get_env NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="$(get_env NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)"
NEXT_PUBLIC_FIREBASE_APP_ID="$(get_env NEXT_PUBLIC_FIREBASE_APP_ID)"
NEXT_PUBLIC_BASE_URL="$(get_env NEXT_PUBLIC_BASE_URL)"
FIREBASE_ADMIN_KEY="$(get_env FIREBASE_ADMIN_KEY)"
GOOGLE_CLOUD_PROJECT_ID="$(get_env GOOGLE_CLOUD_PROJECT_ID)"
GOOGLE_CLOUD_LOCATION="$(get_env GOOGLE_CLOUD_LOCATION)"
GCP_BILLING_ACCOUNT_ID="$(get_env GCP_BILLING_ACCOUNT_ID)"
GCP_FOLDER_ID="$(get_env GCP_FOLDER_ID)"

PROJECT=${PROJECT:-${GOOGLE_CLOUD_PROJECT_ID:-""}}
[[ -z "$PROJECT" ]] && error "No project ID. Set GOOGLE_CLOUD_PROJECT_ID in $ENV_FILE or pass --project"

IMAGE="gcr.io/${PROJECT}/${SERVICE_NAME}"

info "Deploying Gogobot to Cloud Run"
echo "  Project:  $PROJECT"
echo "  Region:   $REGION"
echo "  Service:  $SERVICE_NAME"
echo "  Image:    $IMAGE"
echo ""

# ---- Enable Cloud Run API ----
info "Ensuring Cloud Run API is enabled..."
gcloud services enable run.googleapis.com --project="$PROJECT" 2>/dev/null
gcloud services enable cloudbuild.googleapis.com --project="$PROJECT" 2>/dev/null
ok "APIs enabled"

# ---- Build with Cloud Build ----
info "Building container image via Cloud Build..."
gcloud builds submit . \
  --project="$PROJECT" \
  --config=cloudbuild.yaml \
  --substitutions="_SERVICE_NAME=${SERVICE_NAME},_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},_NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},_NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL:-}" \
  --quiet
ok "Image built: $IMAGE"

# ---- Collect server-side env vars for Cloud Run ----
# Use ^||^ as delimiter instead of comma (FIREBASE_ADMIN_KEY contains commas in JSON)
SEP="^||^"
ENV_VARS="${SEP}NODE_ENV=production"
ENV_VARS+="||GOOGLE_CLOUD_PROJECT_ID=${GOOGLE_CLOUD_PROJECT_ID}"
ENV_VARS+="||GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION:-us-central1}"
ENV_VARS+="||GCP_BILLING_ACCOUNT_ID=${GCP_BILLING_ACCOUNT_ID}"
ENV_VARS+="||GCP_FOLDER_ID=${GCP_FOLDER_ID}"
ENV_VARS+="||FIREBASE_ADMIN_KEY=${FIREBASE_ADMIN_KEY}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}"
ENV_VARS+="||NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}"

if [[ -n "${NEXT_PUBLIC_BASE_URL:-}" ]]; then
  ENV_VARS+="||NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}"
fi

# ---- Deploy to Cloud Run ----
info "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --allow-unauthenticated \
  --port=3000 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="$ENV_VARS" \
  --quiet

# ---- Get the URL ----
URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format="value(status.url)" 2>/dev/null)

# ---- Configure Firebase Auth ----
info "Configuring Firebase Auth..."
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
DOMAIN=$(echo "$URL" | sed 's|https://||')

# Enable Email/Password sign-in
curl -s -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-goog-user-project: $PROJECT" \
  -d '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}' \
  >/dev/null 2>&1

# Add Cloud Run domain to Firebase Auth authorized domains
curl -s -X PATCH \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-goog-user-project: $PROJECT" \
  -d "{\"authorizedDomains\":[\"localhost\",\"${PROJECT}.firebaseapp.com\",\"${PROJECT}.web.app\",\"${DOMAIN}\"]}" \
  >/dev/null 2>&1
ok "Email/Password auth enabled, Cloud Run domain authorized"

echo ""
echo "========================================"
echo "  Deployed!"
echo "========================================"
echo ""
echo "  URL: $URL"
echo ""
echo "  Next steps:"
echo "  1. Update NEXT_PUBLIC_BASE_URL in Cloud Run env vars to: $URL"
echo "     gcloud run services update $SERVICE_NAME --region=$REGION --project=$PROJECT --update-env-vars=NEXT_PUBLIC_BASE_URL=$URL"
echo ""
echo "  2. (Optional) Map a custom domain:"
echo "     gcloud run domain-mappings create --service=$SERVICE_NAME --domain=your-domain.com --region=$REGION --project=$PROJECT"
echo ""
