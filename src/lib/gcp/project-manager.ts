/**
 * GCP Project Manager
 *
 * Creates and manages isolated GCP projects for each Gogobot project.
 * Uses a folder hierarchy for isolation and security:
 *
 *   obot.ai (org)
 *   └── Gogobot Projects (GCP_FOLDER_ID — org admin creates this)
 *       ├── user-shannon (auto-created per user)
 *       │   ├── gogobot-p-abc123 (project)
 *       │   └── gogobot-p-def456 (project)
 *       └── user-other (auto-created per user)
 *           └── gogobot-p-ghi789 (project)
 *
 * The SA only needs permissions on the top-level Gogobot folder,
 * not the entire org. Labels are also applied for billing queries.
 */

import { GoogleAuth } from 'google-auth-library';
import { getAdminDb } from '@/lib/firebase/admin';

// APIs to enable in every new project
const DEFAULT_APIS = [
  'firebasehosting.googleapis.com',
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'logging.googleapis.com',
];

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    const adminKey = process.env.FIREBASE_ADMIN_KEY;
    if (adminKey) {
      const credentials = JSON.parse(adminKey);
      authClient = new GoogleAuth({
        credentials,
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/firebase',
        ],
      });
    } else {
      authClient = new GoogleAuth({
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/firebase',
        ],
      });
    }
  }
  return authClient;
}

async function getAccessToken(): Promise<string> {
  const auth = getAuthClient();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get access token');
  return token.token;
}

async function gcpFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

/**
 * Generate a unique GCP project ID.
 * Must be 6-30 chars, lowercase, digits, hyphens. Must start with a letter.
 */
function generateProjectId(gogobotProjectId: string): string {
  const shortId = gogobotProjectId.slice(0, 8).toLowerCase();
  const random = Math.random().toString(36).slice(2, 6);
  return `gogobot-p-${shortId}-${random}`;
}

/**
 * Sanitize a value for use as a GCP label.
 * Labels: lowercase, digits, hyphens, underscores. Max 63 chars.
 */
function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 63);
}

/**
 * Get the top-level Gogobot folder ID from env.
 * This folder must be created by the org admin and its ID set in GCP_FOLDER_ID.
 */
function getGogobotFolderId(): string {
  const folderId = process.env.GCP_FOLDER_ID;
  if (!folderId) {
    throw new Error(
      'GCP_FOLDER_ID is required. The org admin must create a "Gogobot Projects" folder ' +
      'and grant the service account permissions on it. See CLAUDE.md for setup instructions.'
    );
  }
  return folderId;
}

// ─── User Folder Management ────────────────────────────────────────────────

/**
 * Get or create a per-user sub-folder inside the Gogobot folder.
 * Stores the folder ID in the Firestore user document for reuse.
 */
export async function getOrCreateUserFolder(userId: string, userEmail?: string): Promise<string> {
  const db = getAdminDb();
  const userRef = db.collection('users').doc(userId);

  // Check if user already has a folder
  const userDoc = await userRef.get();
  const existingFolderId = userDoc.data()?.gcpFolderId;
  if (existingFolderId) {
    return existingFolderId;
  }

  // Create a new folder for this user
  const parentFolderId = getGogobotFolderId();
  const displayName = userEmail
    ? `user-${userEmail.split('@')[0]}`
    : `user-${userId.slice(0, 12)}`;

  console.log(`Creating user folder: ${displayName} under folder ${parentFolderId}`);

  const res = await gcpFetch(
    'https://cloudresourcemanager.googleapis.com/v3/folders',
    {
      method: 'POST',
      body: JSON.stringify({
        parent: `folders/${parentFolderId}`,
        displayName,
      }),
    }
  );

  let folderId: string;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const errMsg = err.error?.message || res.statusText;

    // If folder with same display name already exists, find and reuse it
    if (errMsg.includes('display name uniqueness')) {
      console.log(`Folder "${displayName}" already exists, searching for it...`);
      folderId = await findFolderByDisplayName(parentFolderId, displayName);
      console.log(`Found existing folder: ${folderId} for ${userId}`);
    } else {
      throw new Error(`Failed to create user folder: ${errMsg}`);
    }
  } else {
    const op = await res.json();
    // Folder creation is a long-running operation — poll for completion
    try {
      folderId = await waitForFolderOperation(op.name);
      console.log(`User folder created: ${folderId} for ${userId}`);
    } catch (opErr: any) {
      // Operation failed — check if it's a uniqueness constraint (folder already exists)
      if (opErr.message?.includes('display name uniqueness')) {
        console.log(`Folder "${displayName}" already exists, searching for it...`);
        folderId = await findFolderByDisplayName(parentFolderId, displayName);
        console.log(`Found existing folder: ${folderId} for ${userId}`);
      } else {
        throw opErr;
      }
    }
  }

  // Store the folder ID on the user document
  await userRef.set({ gcpFolderId: folderId }, { merge: true });

  return folderId;
}

/**
 * Wait for a folder creation operation to complete.
 * Returns the folder ID (numeric string).
 */
async function waitForFolderOperation(operationName: string, maxWaitMs = 60000): Promise<string> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < maxWaitMs) {
    const res = await gcpFetch(
      `https://cloudresourcemanager.googleapis.com/v3/${operationName}`
    );

    if (!res.ok) {
      throw new Error(`Failed to poll folder operation: ${res.statusText}`);
    }

    const op = await res.json();

    if (op.done) {
      if (op.error) {
        throw new Error(`Folder creation failed: ${op.error.message}`);
      }
      // Extract folder ID from the response name (format: "folders/123456")
      const folderName = op.response?.name;
      if (folderName) {
        return folderName.replace('folders/', '');
      }
      throw new Error('Folder created but no ID returned');
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Timed out waiting for folder creation');
}

/**
 * Find an existing folder by display name under a parent folder.
 * Used when folder creation fails due to display name uniqueness constraint.
 */
async function findFolderByDisplayName(parentFolderId: string, displayName: string): Promise<string> {
  const res = await gcpFetch(
    `https://cloudresourcemanager.googleapis.com/v3/folders?parent=folders/${parentFolderId}&showDeleted=false`
  );

  if (!res.ok) {
    throw new Error(`Failed to list folders: ${res.statusText}`);
  }

  const data = await res.json();
  const folders = data.folders || [];

  for (const folder of folders) {
    if (folder.displayName === displayName && folder.state === 'ACTIVE') {
      return folder.name.replace('folders/', '');
    }
  }

  throw new Error(`Folder "${displayName}" exists but could not be found in listing`);
}

// ─── GCP Project Lifecycle ─────────────────────────────────────────────────

export interface CreateProjectResult {
  gcpProjectId: string;
  projectNumber?: string;
  hostingSiteId?: string;
  hostingUrl?: string;
  enabledApis: string[];
  userFolderId?: string;
  firebaseAppId?: string;
  firebaseConfig?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  error?: string;
}

/**
 * Create a new GCP project for a Gogobot project.
 *
 * Steps:
 * 1. Get or create the user's folder under the Gogobot folder
 * 2. Create the GCP project inside the user's folder
 * 3. Link billing account
 * 4. Enable required APIs
 * 5. Add Firebase to the project
 */
export async function createGcpProject(
  gogobotProjectId: string,
  userId: string,
  projectName: string,
  userEmail?: string
): Promise<CreateProjectResult> {
  const gcpProjectId = generateProjectId(gogobotProjectId);
  const billingAccountId = process.env.GCP_BILLING_ACCOUNT_ID;
  const platformProjectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

  console.log(`Creating GCP project: ${gcpProjectId} for Gogobot project: ${gogobotProjectId}`);

  // Step 1: Get or create the user's folder
  const userFolderId = await getOrCreateUserFolder(userId, userEmail);

  // Step 2: Create the GCP project inside the user's folder
  const createRes = await gcpFetch(
    'https://cloudresourcemanager.googleapis.com/v3/projects',
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: gcpProjectId,
        displayName: `Gogobot - ${projectName}`.replace(/[^a-zA-Z0-9 \-'"/!]/g, '').slice(0, 30),
        parent: `folders/${userFolderId}`,
        labels: {
          'gogobot-user': sanitizeLabel(userId),
          'gogobot-project': sanitizeLabel(gogobotProjectId),
          'gogobot-platform': sanitizeLabel(platformProjectId || 'unknown'),
          'managed-by': 'gogobot',
        },
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(
      `Failed to create GCP project: ${err.error?.message || createRes.statusText}`
    );
  }

  const createOp = await createRes.json();
  console.log(`GCP project creation started: ${createOp.name}`);

  const projectNumber = await waitForProjectOperation(createOp.name);
  console.log(`GCP project created: ${gcpProjectId} (number: ${projectNumber})`);

  // Step 3: Link billing account
  if (billingAccountId) {
    try {
      await linkBillingAccount(gcpProjectId, billingAccountId);
      console.log(`Billing linked for ${gcpProjectId}`);
    } catch (err: any) {
      console.error(`Failed to link billing for ${gcpProjectId}:`, err.message);
    }
  }

  // Step 4: Enable required APIs
  const enabledApis: string[] = [];
  for (const api of DEFAULT_APIS) {
    try {
      await enableApi(gcpProjectId, api);
      enabledApis.push(api);
      console.log(`Enabled ${api} for ${gcpProjectId}`);
    } catch (err: any) {
      console.error(`Failed to enable ${api}:`, err.message);
    }
  }

  // Step 5: Add Firebase to the project
  let hostingSiteId: string | undefined;
  let hostingUrl: string | undefined;
  let firebaseAppId: string | undefined;
  let firebaseConfig: CreateProjectResult['firebaseConfig'] | undefined;

  try {
    await addFirebase(gcpProjectId);
    console.log(`Firebase added to ${gcpProjectId}`);

    hostingSiteId = gcpProjectId;
    hostingUrl = `https://${gcpProjectId}.web.app`;
    console.log(`Hosting site ready: ${hostingUrl}`);

    // Step 6: Create a Firebase Web App and get client config
    try {
      const webApp = await createWebAppAndGetConfig(gcpProjectId);
      firebaseAppId = webApp.appId;
      firebaseConfig = webApp.config;
      console.log(`Firebase Web App created: ${firebaseAppId}`);
    } catch (err: any) {
      console.error(`Failed to create Firebase Web App:`, err.message);
    }

    // Step 7: Create Firestore database so it's ready for apps that need data persistence
    try {
      await createFirestoreDatabase(gcpProjectId);
      console.log(`Firestore database created for ${gcpProjectId}`);
    } catch (err: any) {
      console.error(`Failed to create Firestore database:`, err.message);
    }

    // Step 8: Set open Firestore security rules (sandbox projects allow all reads/writes)
    try {
      await setFirestoreRules(gcpProjectId);
      console.log(`Firestore rules set for ${gcpProjectId}`);
    } catch (err: any) {
      console.error(`Failed to set Firestore rules:`, err.message);
    }
  } catch (err: any) {
    console.error(`Failed to add Firebase:`, err.message);
  }

  return {
    gcpProjectId,
    projectNumber,
    hostingSiteId,
    hostingUrl,
    enabledApis,
    userFolderId,
    firebaseAppId,
    firebaseConfig,
  };
}

// ─── Operation Polling ─────────────────────────────────────────────────────

async function waitForProjectOperation(operationName: string, maxWaitMs = 120000): Promise<string | undefined> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < maxWaitMs) {
    const res = await gcpFetch(
      `https://cloudresourcemanager.googleapis.com/v3/${operationName}`
    );

    if (!res.ok) {
      throw new Error(`Failed to poll operation: ${res.statusText}`);
    }

    const op = await res.json();

    if (op.done) {
      if (op.error) {
        throw new Error(`Operation failed: ${op.error.message}`);
      }
      const projectNumber = op.response?.projectNumber || op.response?.name?.split('/')?.[1];
      return projectNumber;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Timed out waiting for GCP project creation');
}

// ─── Billing ───────────────────────────────────────────────────────────────

async function linkBillingAccount(projectId: string, billingAccountId: string): Promise<void> {
  // Retry up to 3 times — GCP sometimes returns "Precondition check failed"
  // when the project isn't fully propagated yet
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await gcpFetch(
      `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
      {
        method: 'PUT',
        body: JSON.stringify({
          billingAccountName: `billingAccounts/${billingAccountId}`,
          billingEnabled: true,
        }),
      }
    );

    if (res.ok) return;

    const err = await res.json().catch(() => ({}));
    const message = err.error?.message || res.statusText;

    // Retry on precondition failures (project not ready yet)
    if (message.includes('Precondition') && attempt < 2) {
      console.log(`Billing link attempt ${attempt + 1} failed (precondition), retrying in ${5 * (attempt + 1)}s...`);
      await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
      continue;
    }

    throw new Error(`Failed to link billing: ${message}`);
  }
}

// ─── API Management ────────────────────────────────────────────────────────

export async function enableApi(projectId: string, apiName: string): Promise<void> {
  const res = await gcpFetch(
    `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${apiName}:enable`,
    { method: 'POST', body: JSON.stringify({}) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to enable ${apiName}: ${err.error?.message || res.statusText}`);
  }

  const op = await res.json();
  if (op.name && !op.done) {
    await waitForServiceOperation(op.name);
  }
}

async function waitForServiceOperation(operationName: string, maxWaitMs = 60000): Promise<void> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < maxWaitMs) {
    const res = await gcpFetch(
      `https://serviceusage.googleapis.com/v1/${operationName}`
    );

    if (!res.ok) return; // Best effort

    const op = await res.json();
    if (op.done) {
      if (op.error) {
        throw new Error(`Service enable failed: ${op.error.message}`);
      }
      return;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

// ─── Firebase ──────────────────────────────────────────────────────────────

async function addFirebase(projectId: string): Promise<void> {
  const res = await gcpFetch(
    `https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`,
    { method: 'POST', body: JSON.stringify({}) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error?.message?.includes('already') || err.error?.code === 409) {
      return;
    }
    throw new Error(`Failed to add Firebase: ${err.error?.message || res.statusText}`);
  }

  const op = await res.json();
  if (op.name && !op.done) {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const pollRes = await gcpFetch(
        `https://firebase.googleapis.com/v1beta1/${op.name}`
      );
      if (!pollRes.ok) break;
      const pollOp = await pollRes.json();
      if (pollOp.done) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

/**
 * Create a Firebase Web App and retrieve its client config (apiKey, authDomain, etc.).
 * This must be called after addFirebase().
 */
async function createWebAppAndGetConfig(projectId: string): Promise<{
  appId: string;
  config: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
}> {
  // Step 1: Create the web app
  const createRes = await gcpFetch(
    `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`,
    {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Web App' }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Failed to create web app: ${err.error?.message || createRes.statusText}`);
  }

  const createResult = await createRes.json();

  // The response may be an LRO — poll if needed
  let appId: string | undefined;
  if (createResult.name && !createResult.appId) {
    // It's a long-running operation
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const pollRes = await gcpFetch(
        `https://firebase.googleapis.com/v1beta1/${createResult.name}`
      );
      if (!pollRes.ok) break;
      const pollOp = await pollRes.json();
      if (pollOp.done) {
        appId = pollOp.response?.appId;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } else {
    appId = createResult.appId;
  }

  if (!appId) {
    throw new Error('Web app created but no appId returned');
  }

  // Step 2: Get the web app config (with retries — config may take a moment to propagate)
  let config: any;
  const configStart = Date.now();
  while (Date.now() - configStart < 30000) {
    const configRes = await gcpFetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${appId}/config`
    );

    if (configRes.ok) {
      config = await configRes.json();
      if (config.apiKey) break;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (!config?.apiKey) {
    throw new Error('Failed to retrieve web app config (no apiKey)');
  }

  return {
    appId,
    config: {
      apiKey: config.apiKey,
      authDomain: config.authDomain || `${projectId}.firebaseapp.com`,
      projectId: config.projectId || projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId || appId,
    },
  };
}

// ─── Firestore Database ─────────────────────────────────────────────────────

/**
 * Create the default Firestore database for a project.
 * This pre-provisions Firestore so the AI doesn't need to do it via gcpRequest.
 */
async function createFirestoreDatabase(projectId: string): Promise<void> {
  const res = await gcpFetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`,
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'FIRESTORE_NATIVE',
        locationId: process.env.GCP_FIRESTORE_LOCATION || 'nam5',
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Already exists is fine
    if (err.error?.code === 409 || err.error?.message?.includes('already exists')) {
      return;
    }
    throw new Error(`Failed to create Firestore database: ${err.error?.message || res.statusText}`);
  }

  // It's a long-running operation — poll for completion
  const op = await res.json();
  if (op.name && !op.done) {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const pollRes = await gcpFetch(
        `https://firestore.googleapis.com/v1/${op.name}`
      );
      if (!pollRes.ok) break;
      const pollOp = await pollRes.json();
      if (pollOp.done) {
        if (pollOp.error) {
          // Already exists is fine
          if (pollOp.error.code === 6 || pollOp.error.message?.includes('already exists')) {
            return;
          }
          throw new Error(`Firestore database creation failed: ${pollOp.error.message}`);
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// ─── Firestore Security Rules ─────────────────────────────────────────────

/**
 * Set open Firestore security rules for a sandbox project.
 * These projects are user sandboxes, so we allow all reads/writes.
 */
async function setFirestoreRules(projectId: string): Promise<void> {
  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`;

  // Retry once if API isn't propagated yet
  for (let attempt = 0; attempt < 2; attempt++) {
    // Step 1: Create a ruleset
    const rulesetRes = await gcpFetch(
      `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
      {
        method: 'POST',
        body: JSON.stringify({
          source: {
            files: [{ name: 'firestore.rules', content: rules }],
          },
        }),
      }
    );

    if (!rulesetRes.ok) {
      const err = await rulesetRes.json().catch(() => ({}));
      if ((err.error?.code === 403 || err.error?.code === 404) && attempt === 0) {
        // API may not be propagated yet — wait and retry
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      throw new Error(`Failed to create Firestore ruleset: ${err.error?.message || rulesetRes.statusText}`);
    }

    const ruleset = await rulesetRes.json();
    const rulesetName = ruleset.name;

    // Step 2: Deploy the ruleset as the active release
    const releaseRes = await gcpFetch(
      `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: `projects/${projectId}/releases/cloud.firestore`,
          rulesetName,
        }),
      }
    );

    if (!releaseRes.ok) {
      // If release already exists, try updating it instead
      const err = await releaseRes.json().catch(() => ({}));
      if (err.error?.code === 409) {
        const updateRes = await gcpFetch(
          `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: `projects/${projectId}/releases/cloud.firestore`,
              rulesetName,
            }),
          }
        );
        if (!updateRes.ok) {
          const updateErr = await updateRes.json().catch(() => ({}));
          throw new Error(`Failed to update Firestore rules release: ${updateErr.error?.message || updateRes.statusText}`);
        }
      } else {
        throw new Error(`Failed to create Firestore rules release: ${err.error?.message || releaseRes.statusText}`);
      }
    }

    return; // Success
  }
}

// ─── Cloud Storage CORS ──────────────────────────────────────────────────

/**
 * Configure CORS on the default Firebase Storage bucket for a project.
 * Allows all origins since these are sandbox projects with unpredictable hosting domains.
 */
export async function configureStorageCors(projectId: string): Promise<void> {
  const bucket = `${projectId}.firebasestorage.app`;

  const res = await gcpFetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}?projection=full`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        cors: [{
          origin: ['*'],
          method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
          maxAgeSeconds: 3600,
          responseHeader: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With'],
        }],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 404 = bucket doesn't exist yet — that's fine, it'll be created later
    if (err.error?.code === 404) {
      console.log(`Storage bucket ${bucket} not found yet — CORS will need to be configured later`);
      return;
    }
    throw new Error(`Failed to configure Storage CORS: ${err.error?.message || res.statusText}`);
  }
}

// ─── Status & Cleanup ──────────────────────────────────────────────────────

export async function getGcpProjectStatus(projectId: string): Promise<{
  exists: boolean;
  state?: string;
  enabledApis?: string[];
}> {
  const res = await gcpFetch(
    `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`
  );

  if (!res.ok) {
    return { exists: false };
  }

  const project = await res.json();

  let enabledApis: string[] = [];
  try {
    const servicesRes = await gcpFetch(
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services?filter=state:ENABLED`
    );
    if (servicesRes.ok) {
      const servicesData = await servicesRes.json();
      enabledApis = (servicesData.services || []).map((s: any) =>
        s.config?.name || s.name?.split('/')?.pop() || ''
      );
    }
  } catch {
    // Best effort
  }

  return {
    exists: true,
    state: project.state,
    enabledApis,
  };
}

export async function deleteGcpProject(projectId: string): Promise<void> {
  const res = await gcpFetch(
    `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`,
    { method: 'DELETE' }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to delete project: ${err.error?.message || res.statusText}`);
  }
}

export async function undeleteGcpProject(projectId: string): Promise<void> {
  const res = await gcpFetch(
    `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}:undelete`,
    { method: 'POST' }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to restore project: ${err.error?.message || res.statusText}`);
  }
}
