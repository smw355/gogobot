# Gogobot - Self-Hosted AI Cloud Platform

## Project Overview

Gogobot is a self-hosted AI cloud platform where users describe what they want, AI builds it live in browser, and deploys to isolated GCP infrastructure. A platform owner deploys Gogobot, provides GCP credentials, and takes on cost responsibility for all users on the platform.

**Key design decisions**:
- **Per-project GCP isolation**: Each Gogobot project gets its own GCP project for true resource isolation
- **Folder-based security**: SA is scoped to one folder — can't touch anything else in the org
- **Per-user sub-folders**: Each user's projects are grouped in their own folder for easy management
- **AI as GCP expert**: The AI handles all cloud complexity so users don't need GCP knowledge
- **Billing labels**: All projects labeled for per-user cost tracking via Cloud Billing API

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│            Platform GCP Project (gogobot-platform)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Cloud Run   │  │  Firestore   │  │  Vertex AI   │          │
│  │  (Gogobot    │  │  (Platform   │  │  (Gemini 3   │          │
│  │   Server)    │  │   Data)      │  │   Pro)       │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
         │ Creates & manages (scoped to folder only)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  obot.ai (org)                                                   │
│  └── Gogobot Projects (GCP_FOLDER_ID)                           │
│      ├── user-shannon (auto-created per user)                   │
│      │   ├── gogobot-p-abc123  [Firebase Hosting, Firestore]    │
│      │   └── gogobot-p-def456  [Firebase Hosting, Cloud Run]    │
│      └── user-other (auto-created per user)                     │
│          └── gogobot-p-ghi789  [Firebase Hosting]               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Chat Panel  │  │ WebContainer │  │    Preview Panel      │ │
│  │  User ←→ AI  │  │  (Node.js)   │  │   (Live App View)     │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## New Instance Setup Guide

Complete steps for deploying a new Gogobot instance. You'll need a GCP Organization and a billing account.

### Step 1: Create the Platform GCP Project

This project hosts Gogobot itself (the server, database, AI).

```bash
# Create a new GCP project (or use an existing one)
gcloud projects create gogobot-platform --name="Gogobot Platform"

# Link it to your billing account
gcloud billing projects link gogobot-platform \
  --billing-account=YOUR_BILLING_ACCOUNT_ID
```

### Step 2: Enable Platform APIs

These APIs are needed on the **platform project** (not the per-user projects):

```bash
PROJECT=gogobot-platform

gcloud services enable aiplatform.googleapis.com       --project=$PROJECT  # Vertex AI (Gemini)
gcloud services enable firestore.googleapis.com        --project=$PROJECT  # Firestore (app data)
gcloud services enable identitytoolkit.googleapis.com  --project=$PROJECT  # Firebase Auth
gcloud services enable cloudbilling.googleapis.com     --project=$PROJECT  # Billing API (link child projects)
gcloud services enable serviceusage.googleapis.com     --project=$PROJECT  # Service Usage API
gcloud services enable cloudresourcemanager.googleapis.com --project=$PROJECT  # Resource Manager
gcloud services enable firebase.googleapis.com         --project=$PROJECT  # Firebase Management
gcloud services enable firebasehosting.googleapis.com  --project=$PROJECT  # Firebase Hosting
gcloud services enable storage.googleapis.com          --project=$PROJECT  # Cloud Storage (asset uploads)
```

### Step 3: Set Up Firebase

```bash
# Add Firebase to the platform project
firebase projects:addfirebase gogobot-platform

# Create a Firestore database
gcloud firestore databases create --project=$PROJECT --location=us-central1

# Enable Email/Password auth in Firebase Console:
# https://console.firebase.google.com/project/gogobot-platform/authentication/providers
# → Enable Email/Password sign-in
```

Get the Firebase client config from **Firebase Console → Project Settings → General → Your apps → Add web app**. You'll need:
- API Key, Auth Domain, Project ID, Storage Bucket, Messaging Sender ID, App ID

### Step 4: Create the Service Account

```bash
PROJECT=gogobot-platform

# Create the service account
gcloud iam service-accounts create gogobot-admin \
  --display-name="Gogobot Admin SA" \
  --project=$PROJECT

SA=gogobot-admin@${PROJECT}.iam.gserviceaccount.com

# Grant it owner on the platform project (or use more granular roles below)
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" \
  --role="roles/owner"

# Export the key (keep this secret!)
gcloud iam service-accounts keys create gogobot-sa-key.json \
  --iam-account=$SA

# The contents of gogobot-sa-key.json go into the FIREBASE_ADMIN_KEY env var (as a single-line JSON string)
```

**Granular alternative to `roles/owner`** (if you prefer least-privilege on the platform project):
- `roles/datastore.user` — Firestore read/write
- `roles/aiplatform.user` — Vertex AI (Gemini)
- `roles/firebaseauth.admin` — Firebase Auth management
- `roles/serviceusage.serviceUsageAdmin` — Enable APIs on child projects

### Step 5: Create the Gogobot Folder (Org Admin Required)

This is the ONE thing that requires org-level access. The org admin creates a folder and grants the SA permissions scoped to that folder only. **The SA cannot see or modify anything outside this folder.**

```bash
SA=gogobot-admin@gogobot-platform.iam.gserviceaccount.com

# 1. Create the Gogobot folder (org admin does this)
gcloud resource-manager folders create \
  --display-name="Gogobot Projects" \
  --organization=YOUR_ORG_ID

# Note the folder ID from output (e.g., folders/123456789)
FOLDER_ID=123456789

# 2. Grant 5 roles ON THE FOLDER ONLY
gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:$SA" \
  --role="roles/resourcemanager.projectCreator"

gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:$SA" \
  --role="roles/resourcemanager.projectDeleter"

gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:$SA" \
  --role="roles/resourcemanager.folderCreator"

gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:$SA" \
  --role="roles/firebase.admin"

gcloud resource-manager folders add-iam-policy-binding $FOLDER_ID \
  --member="serviceAccount:$SA" \
  --role="roles/editor"
```

**What these roles do:**
| Role | Purpose |
|------|---------|
| `projectCreator` | Create isolated GCP projects for each Gogobot project |
| `projectDeleter` | Clean up GCP projects when Gogobot projects are deleted |
| `folderCreator` | Create per-user sub-folders for organization |
| `firebase.admin` | Add Firebase to child projects, manage Hosting |
| `editor` | Full resource management in child projects (Cloud Run, Storage, Vertex AI, etc.) |

**What the SA can do:** Create sub-folders and projects inside the Gogobot folder. Manage all resources within those projects.
**What the SA cannot do:** See, modify, or create anything outside the Gogobot folder. Cannot modify IAM policies. Cannot access the org or billing account settings.

### Step 6: Grant Billing Permission

The SA needs to link new projects to the billing account:

```bash
SA=gogobot-admin@gogobot-platform.iam.gserviceaccount.com

gcloud billing accounts add-iam-policy-binding YOUR_BILLING_ACCOUNT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/billing.user"
```

This only allows linking projects to the billing account — it does **not** grant access to view invoices, modify billing settings, or manage payment methods.

### Step 7: Configure Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
# Firebase Client (from Step 3 — Firebase Console)
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=gogobot-platform.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=gogobot-platform
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=gogobot-platform.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123

# Firebase Admin (from Step 4 — contents of gogobot-sa-key.json as single-line JSON)
FIREBASE_ADMIN_KEY={"type":"service_account","project_id":"gogobot-platform",...}

# GCP Config
GOOGLE_CLOUD_PROJECT_ID=gogobot-platform
GOOGLE_CLOUD_LOCATION=us-central1

# GCP Isolation (from Steps 5 & 6)
GCP_BILLING_ACCOUNT_ID=01XXXX-XXXXXX-XXXXXX
GCP_FOLDER_ID=123456789

# Application
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Step 8: Deploy & First Login

```bash
npm install
npm run build
npm run dev  # or deploy to Cloud Run / Vercel
```

The first user to sign up automatically becomes the admin.

### Summary of Permissions

| Scope | Role | Purpose |
|-------|------|---------|
| Platform project | `roles/owner` (or granular) | Run Gogobot, access Firestore, Vertex AI |
| Gogobot folder | `roles/resourcemanager.projectCreator` | Create child GCP projects |
| Gogobot folder | `roles/resourcemanager.projectDeleter` | Delete child GCP projects |
| Gogobot folder | `roles/resourcemanager.folderCreator` | Create per-user sub-folders |
| Gogobot folder | `roles/firebase.admin` | Manage Firebase in child projects |
| Gogobot folder | `roles/editor` | Manage all resources in child projects |
| Billing account | `roles/billing.user` | Link child projects to billing |

### Request Template for Org Admin

If you need to request the folder + permissions from your org admin, here's a template:

> We need a single GCP folder created in the org for Gogobot to manage its isolated projects. The service account will be scoped to this folder only and cannot access anything else in the org.
>
> **Service Account:** `gogobot-admin@YOUR-PROJECT.iam.gserviceaccount.com`
>
> **Request:**
> 1. Create a folder called "Gogobot Projects" under the org
> 2. Grant the SA these 5 roles **on that folder only**:
>    - `roles/resourcemanager.projectCreator`
>    - `roles/resourcemanager.projectDeleter`
>    - `roles/resourcemanager.folderCreator`
>    - `roles/firebase.admin`
>    - `roles/editor`
> 3. Grant `roles/billing.user` on billing account `YOUR_BILLING_ACCOUNT_ID`
>
> **Security scope:** The SA is sandboxed to this one folder. It cannot see or modify any other resources in the org. It cannot modify IAM policies, access billing settings, or manage the organization itself.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TailwindCSS
- **AI**: Gemini 3 Pro Preview via Vertex AI SDK (location: global), fallback to Gemini 2.5 Pro (us-central1)
- **Browser Runtime**: StackBlitz WebContainers API
- **Auth**: Firebase Authentication (Email/Password)
- **Database**: Firestore (platform data)
- **GCP Management**: google-auth-library + REST APIs (Resource Manager, Service Usage, Firebase Management, Firebase Hosting)
- **Deployment**: Per-project Firebase Hosting via REST API

## Key Features

- **Email/Password Auth** - Simple authentication with admin/user roles
- **Per-Project GCP Isolation** - Each project gets its own GCP project with isolated resources
- **Per-User Folder Grouping** - Each user's projects in their own GCP folder
- **WebContainer Integration** - Browser-side Node.js for live preview
- **Gemini AI Chat** - Streaming responses with function calling (15 tools)
- **Live Preview** - Vite dev server running in browser
- **Real Firebase Hosting Deployment** - Hash-based file upload to project-specific hosting sites
- **Server-Side GCP Tools** - AI can query project info, enable APIs, view logs
- **Billing Labels** - All GCP projects labeled for per-user cost tracking

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/           # Login page
│   ├── (dashboard)/
│   │   ├── projects/           # Project list and editor
│   │   └── settings/           # Admin settings
│   └── api/
│       ├── auth/               # Session management
│       └── projects/
│           ├── route.ts        # POST: Create project + GCP provisioning
│           └── [projectId]/
│               ├── chat/       # AI chat streaming
│               ├── deploy/     # Real Firebase Hosting deployment
│               ├── tools/      # Server-side GCP tool execution
│               ├── messages/   # Chat history persistence
│               └── snapshot/   # File snapshots
├── components/
│   ├── chat/                   # Chat interface components
│   └── ui/                     # Basic UI components
├── hooks/
│   ├── useAuth.ts              # Auth state
│   └── useChat.ts              # Chat + tool execution (agentic loop)
├── lib/
│   ├── ai/
│   │   ├── api-client.ts       # Client-side streaming API client
│   │   ├── system-prompt.ts    # GCP-aware system prompt with dynamic context
│   │   ├── tool-executor.ts    # Routes tools: WebContainer (local) vs GCP (server-side)
│   │   ├── tools.ts            # Gemini function declarations (15 tools)
│   │   └── types.ts            # AI types (Message, ToolCall, etc.)
│   ├── gcp/
│   │   ├── project-manager.ts  # GCP project + folder lifecycle
│   │   └── firebase-hosting.ts # Firebase Hosting deployment via REST API
│   ├── firebase/               # Firebase config (client + admin)
│   ├── auth/                   # Session verification
│   └── webcontainer/           # WebContainer manager
└── types/                      # TypeScript types (Project, GcpProjectConfig, etc.)
```

## Tool Architecture

Tools are split into two categories:

### Client-Side Tools (execute in WebContainer)
`writeFile`, `patchFile`, `readFile`, `deleteFile`, `listFiles`, `runCommand`, `searchFiles`, `getErrors`, `getConsoleOutput`, `installPackage`

### Server-Side Tools (execute via API with GCP credentials)
`deploy`, `getProjectInfo`, `enableApi`, `viewLogs`, `gcpRequest`

The `ToolExecutor` routes server-side tools to `/api/projects/{id}/tools` which executes them with the platform's GCP service account credentials. `gcpRequest` is a general-purpose tool that lets the AI make any GCP REST API call within the project's scope (URL must reference the project's GCP project ID, blocked from IAM/org/billing operations).

## AI Model Configuration

- **Primary**: `gemini-3-pro-preview` with `location: 'global'` and `apiEndpoint: 'aiplatform.googleapis.com'`
- **Fallback**: `gemini-2.5-pro` with standard `us-central1` location
- Fallback triggers on: 429, 503, 500 errors, or model unavailability

## GCP Project Lifecycle

1. User creates a Gogobot project → API creates Firestore doc with `gcpProject.status: 'provisioning'`
2. Background async:
   a. `getOrCreateUserFolder()` → checks Firestore for existing folder, creates one if needed
   b. `createGcpProject()` → creates project inside user's folder → links billing → enables APIs → adds Firebase
3. Firestore updated with `gcpProject.status: 'ready'` and project details
4. AI can now deploy to the project's own Firebase Hosting site
5. AI can enable additional APIs (Cloud Run, Cloud Storage, etc.) as needed

## Data Model

```
/config/instance          # Instance configuration (billingAccountId, etc.)
/users/{userId}           # User profiles with role
  gcpFolderId             # Per-user GCP folder ID (auto-created on first project)
/projects/{projectId}     # User projects
  gcpProject: {           # Per-project GCP isolation config
    projectId             # GCP project ID (e.g., "gogobot-p-abc123-x7k2")
    hostingSiteId         # Firebase Hosting site ID
    hostingUrl            # Live URL
    userFolderId          # User's GCP folder ID
    region                # GCP region
    status                # provisioning | ready | error | deleted
    enabledApis[]         # Enabled GCP APIs
  }
  /messages/{messageId}   # Chat history
  /snapshots/{snapshotId} # File snapshots
  /deployments/{id}       # Deployment history
```

## Environment Variables

See `.env.example` for required configuration. Key vars for GCP isolation:
- `GCP_BILLING_ACCOUNT_ID` - Billing account for provisioned projects
- `GCP_FOLDER_ID` - Top-level Gogobot folder (org admin creates this)

## Development

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
```

## Notes

- WebContainers only work in Chromium-based browsers
- First user to sign up becomes admin
- Each project deploys to its own Firebase Hosting site (true isolation)
- Each user's projects are grouped in a GCP folder (user-{name})
- GCP projects also have billing labels: `gogobot-user`, `gogobot-project`, `managed-by`
- SA is scoped to ONE folder — can't touch anything else in the org
