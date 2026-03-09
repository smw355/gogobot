# Gogobot

A self-hosted AI cloud platform. Users describe what they want, AI builds it live in the browser, and deploys to isolated Google Cloud infrastructure.

The platform owner deploys a Gogobot instance, provides GCP credentials, and manages cost for all users. Each project gets its own GCP project with full resource isolation — users never need to touch GCP directly.

## How it works

```
User: "Build me a bakery website with an order form"
  ↓
Gogobot AI builds the app live in-browser (WebContainers)
  ↓
User sees live preview, iterates with the AI
  ↓
One click → deploys to the project's own Firebase Hosting site
```

**What users can build:**
- Static websites and landing pages
- SaaS apps with user auth and databases (Firebase Auth + Firestore)
- AI-powered assistants and chatbots
- Automation workflows with API integrations

**What the platform provides:**
- Per-project GCP isolation (each project gets its own GCP project)
- Per-user folder grouping for organization and billing
- Live in-browser development via WebContainers
- AI chat with 15+ tools (file editing, package management, deployment, cloud APIs)
- Secrets management with deploy-time injection
- Asset uploads (images, PDFs, fonts) via Cloud Storage
- Real Firebase Hosting deployment per project

## Architecture

```
Platform GCP Project (your-project)
├── Cloud Run        → Gogobot server (Next.js)
├── Firestore        → Platform data (users, projects, chat history)
├── Vertex AI        → Gemini Pro for AI chat
└── Cloud Storage    → User-uploaded assets

GCP Organization
└── Gogobot Projects (folder)        ← SA scoped here only
    ├── user-alice/
    │   ├── gogobot-p-abc123         ← Alice's project (Firebase Hosting)
    │   └── gogobot-p-def456         ← Another project
    └── user-bob/
        └── gogobot-p-ghi789         ← Bob's project

Browser
├── Chat Panel       → User ↔ AI conversation
├── WebContainer     → In-browser Node.js runtime
└── Preview Panel    → Live app preview (Vite dev server)
```

## Tech stack

- **Frontend**: Next.js 16 (App Router), React 18, Tailwind CSS
- **AI**: Gemini 3 Pro via Vertex AI, fallback to Gemini 2.5 Pro
- **Browser runtime**: StackBlitz WebContainers
- **Auth**: Firebase Authentication (email/password)
- **Database**: Firestore
- **Deployment**: Per-project Firebase Hosting via REST API
- **Infrastructure**: Google Cloud Run (platform), isolated GCP projects (user apps)

---

## Setup Guide

This guide walks through setting up a new Gogobot instance from scratch. You'll need:

- A Google Cloud organization
- A billing account
- `gcloud` CLI installed and authenticated
- Node.js 18+

### Option A: Automated setup

The setup script handles steps 1-5 automatically:

```bash
./scripts/setup-gcp.sh
```

It will prompt for your org ID, billing account, and project name, then create everything and generate a `.env.generated` file. Skip to [Step 6](#step-6-configure-firebase-auth) after running it.

### Option B: Manual setup

#### Step 1: Create the platform GCP project

This project hosts the Gogobot server, database, and AI.

```bash
PROJECT=your-project-id

# Create the project (or use an existing one)
gcloud projects create $PROJECT --name="Gogobot Platform"

# Link billing
gcloud billing projects link $PROJECT \
  --billing-account=YOUR_BILLING_ACCOUNT_ID
```

#### Step 2: Enable platform APIs

```bash
gcloud services enable aiplatform.googleapis.com       --project=$PROJECT  # Vertex AI (Gemini)
gcloud services enable firestore.googleapis.com        --project=$PROJECT  # Firestore
gcloud services enable identitytoolkit.googleapis.com  --project=$PROJECT  # Firebase Auth
gcloud services enable cloudbilling.googleapis.com     --project=$PROJECT  # Billing API
gcloud services enable serviceusage.googleapis.com     --project=$PROJECT  # Service Usage
gcloud services enable cloudresourcemanager.googleapis.com --project=$PROJECT  # Resource Manager
gcloud services enable firebase.googleapis.com         --project=$PROJECT  # Firebase Management
gcloud services enable firebasehosting.googleapis.com  --project=$PROJECT  # Firebase Hosting
gcloud services enable storage.googleapis.com          --project=$PROJECT  # Cloud Storage (assets)
```

#### Step 3: Set up Firestore

```bash
gcloud firestore databases create --project=$PROJECT --location=us-central1
```

#### Step 4: Create the service account

```bash
SA_NAME=gogobot-admin
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

# Create the SA
gcloud iam service-accounts create $SA_NAME \
  --display-name="Gogobot Admin SA" \
  --project=$PROJECT

# Grant owner on the platform project
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/owner"

# Export the key (keep this secret)
gcloud iam service-accounts keys create gogobot-sa-key.json \
  --iam-account=$SA_EMAIL
```

> **Least-privilege alternative** to `roles/owner` on the platform project: `roles/datastore.user`, `roles/aiplatform.user`, `roles/firebaseauth.admin`, `roles/serviceusage.serviceUsageAdmin`.

#### Step 5: Create the Gogobot folder

This is where all user projects live. The SA is scoped to this folder only — it cannot see or modify anything else in your org.

**This step requires Organization Admin or Folder Creator access.**

```bash
SA_EMAIL=gogobot-admin@${PROJECT}.iam.gserviceaccount.com

# Create the folder
gcloud resource-manager folders create \
  --display-name="Gogobot Projects" \
  --organization=YOUR_ORG_ID

# Note the folder ID from the output (e.g., 123456789)
FOLDER_ID=123456789

# Grant 5 roles on the folder
for role in \
  roles/resourcemanager.projectCreator \
  roles/resourcemanager.projectDeleter \
  roles/resourcemanager.folderCreator \
  roles/firebase.admin \
  roles/editor; do
  gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --quiet
done

# Grant billing permission (to link new projects to your billing account)
gcloud billing accounts add-iam-policy-binding YOUR_BILLING_ACCOUNT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/billing.user"
```

**What these roles allow:**

| Role | Purpose |
|------|---------|
| `projectCreator` | Create isolated GCP projects per Gogobot project |
| `projectDeleter` | Clean up GCP projects on deletion |
| `folderCreator` | Create per-user sub-folders |
| `firebase.admin` | Manage Firebase in child projects |
| `editor` | Manage resources (Hosting, Cloud Run, etc.) in child projects |
| `billing.user` | Link new projects to the billing account |

**What the SA cannot do:** access anything outside the Gogobot folder, modify IAM policies, view billing invoices, or manage the organization.

<details>
<summary>Template to send to your org admin (if you don't have org access)</summary>

> We need a single GCP folder created in the org for Gogobot to manage its isolated projects. The service account will be scoped to this folder only.
>
> **Service Account:** `gogobot-admin@YOUR-PROJECT.iam.gserviceaccount.com`
>
> **Request:**
> 1. Create a folder called "Gogobot Projects" under the org
> 2. Grant the SA these 5 roles **on that folder only**: `projectCreator`, `projectDeleter`, `folderCreator`, `firebase.admin`, `editor`
> 3. Grant `roles/billing.user` on billing account `YOUR_BILLING_ACCOUNT_ID`
>
> The SA cannot see or modify any other resources in the org.

</details>

#### Step 6: Configure Firebase Auth

1. Add Firebase to your project:
   ```bash
   firebase projects:addfirebase $PROJECT
   ```

2. Enable Email/Password authentication in the [Firebase Console](https://console.firebase.google.com):
   - Go to **Authentication** > **Sign-in method**
   - Enable **Email/Password**

3. Create a web app to get client config:
   - Go to **Project Settings** > **General** > **Your apps** > **Add app** > **Web**
   - Copy the config values (apiKey, authDomain, projectId, etc.)

#### Step 7: Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
# Firebase Client (from Step 6 — Firebase Console)
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123

# Firebase Admin (contents of gogobot-sa-key.json as a single-line JSON string)
FIREBASE_ADMIN_KEY={"type":"service_account","project_id":"your-project",...}

# GCP Config
GOOGLE_CLOUD_PROJECT_ID=your-project
GOOGLE_CLOUD_LOCATION=us-central1

# GCP Isolation (from Steps 1 and 5)
GCP_BILLING_ACCOUNT_ID=01XXXX-XXXXXX-XXXXXX
GCP_FOLDER_ID=123456789

# Application
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

#### Step 8: Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first user to sign up automatically becomes the admin.

---

## Deploying to Cloud Run

Once you've verified everything works locally, deploy to Cloud Run:

```bash
./scripts/deploy-cloudrun.sh
```

The script will:
1. Build a Docker image via Cloud Build
2. Deploy to Cloud Run with proper environment variables
3. Print the URL when done

After deployment, update the base URL:

```bash
gcloud run services update gogobot \
  --region=us-central1 \
  --project=your-project \
  --update-env-vars=NEXT_PUBLIC_BASE_URL=https://your-cloud-run-url
```

You can also pass options:

```bash
./scripts/deploy-cloudrun.sh --project my-project --region us-east1 --service my-service
```

### Custom domain

```bash
gcloud run domain-mappings create \
  --service=gogobot \
  --domain=your-domain.com \
  --region=us-central1 \
  --project=your-project
```

---

## User management

- The **first user** to sign up becomes the admin
- Additional users need an **invite token** generated by the admin
- Go to **Settings** (admin only) to create invite links
- Each user's projects are isolated in their own GCP folder

---

## How projects work

When a user creates a project:

1. A Firestore document is created for the project
2. A GCP project is provisioned inside the user's folder (~30-90 seconds)
3. Firebase Hosting is set up on the child project
4. The user chats with the AI to build their app
5. The AI writes code in a WebContainer (browser-side Node.js)
6. The user sees a live preview via the Vite dev server
7. One-click deploy pushes to the project's Firebase Hosting site

The AI has access to 15+ tools:

| Tool | Runs on | Purpose |
|------|---------|---------|
| `writeFile`, `patchFile`, `readFile`, `deleteFile`, `listFiles` | Browser | File operations in WebContainer |
| `runCommand`, `installPackage` | Browser | Shell commands, npm install |
| `searchFiles` | Browser | Grep-style code search |
| `getErrors`, `getConsoleOutput` | Browser | Debug info from dev server |
| `deploy` | Server | Push to Firebase Hosting |
| `getProjectInfo` | Server | GCP project status and Firebase config |
| `enableApi` | Server | Enable GCP APIs on the child project |
| `viewLogs` | Server | Read Cloud Logging entries |
| `gcpRequest` | Server | General-purpose GCP REST API calls |
| `getSecrets`, `getSecretValue` | Server | Read secrets for deploy-time injection |
| `listAssets` | Server | List uploaded assets and their URLs |

---

## Project structure

```
src/
├── app/
│   ├── (auth)/login/              # Login page
│   ├── (dashboard)/
│   │   ├── projects/              # Project list + editor
│   │   └── settings/              # Admin settings (invites)
│   └── api/
│       ├── auth/                  # Session management
│       ├── admin/                 # Admin endpoints (invites, users)
│       └── projects/
│           └── [projectId]/
│               ├── chat/          # AI streaming chat
│               ├── deploy/        # Firebase Hosting deployment
│               ├── tools/         # Server-side GCP tool execution
│               ├── secrets/       # Secrets management
│               ├── assets/        # File upload (Cloud Storage)
│               ├── messages/      # Chat history
│               └── snapshot/      # File state snapshots
├── components/
│   ├── chat/                      # Chat UI, file upload, input
│   ├── assets/                    # Asset management panel
│   ├── secrets/                   # Secrets management panel
│   └── ui/                        # Shared UI components
├── hooks/
│   ├── useAuth.ts                 # Auth state
│   └── useChat.ts                 # Chat + agentic tool loop
├── lib/
│   ├── ai/                        # System prompt, tools, executor
│   ├── gcp/                       # GCP project manager, Firebase Hosting
│   ├── firebase/                  # Firebase config (client + admin)
│   ├── auth/                      # Session verification
│   └── webcontainer/              # WebContainer manager
└── types/                         # TypeScript types
```

---

## Security model

- **Session cookies**: httpOnly, secure, sameSite=strict, 14-day TTL
- **API routes**: All protected with `verifySession()`, project ownership checks
- **Admin routes**: Protected with `verifyAdmin()`
- **GCP isolation**: SA scoped to one folder, cannot access anything else in the org
- **GCP request validation**: `gcpRequest` tool blocks IAM, org, billing, and folder operations; enforces HTTPS; requires URL to reference the project's own GCP project ID
- **Firestore rules**: Users can only access their own projects and data
- **Secrets**: Stored in Firestore, values injected at deploy time (never exposed to browser)
- **Assets**: Stored in Cloud Storage with public URLs (intended for use in deployed websites)

---

## Development

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run lint     # ESLint
```

**Notes:**
- WebContainers only work in Chromium-based browsers
- The dev server requires `COOP` and `COEP` headers (configured in `next.config.ts`)
- Vertex AI SDK uses the service account key from `FIREBASE_ADMIN_KEY` (not ADC)

---

## License

Private. All rights reserved.
