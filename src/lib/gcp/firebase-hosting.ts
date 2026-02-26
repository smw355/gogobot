/**
 * Firebase Hosting Deployment
 *
 * Deploys static files to a Firebase Hosting site using the REST API.
 * Each Gogobot project deploys to its own Firebase Hosting site
 * in its own GCP project.
 *
 * Flow:
 * 1. Create a new version
 * 2. Populate files (hash-based upload)
 * 3. Finalize the version
 * 4. Create a release to make it live
 */

import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

let authClient: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth {
  if (!authClient) {
    const adminKey = process.env.FIREBASE_ADMIN_KEY;
    if (adminKey) {
      const credentials = JSON.parse(adminKey);
      authClient = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    } else {
      authClient = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
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

async function hostingFetch(url: string, options: RequestInit = {}): Promise<Response> {
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
 * Gzip content and compute its SHA256 hash.
 * Firebase Hosting requires gzip-compressed content for both hashing and upload.
 */
function gzipContent(content: string): Buffer {
  return gzipSync(Buffer.from(content, 'utf8'));
}

function hashGzipped(gzipped: Buffer): string {
  return createHash('sha256').update(gzipped).digest('hex');
}

export interface DeployResult {
  success: boolean;
  url?: string;
  versionId?: string;
  error?: string;
}

/**
 * Deploy files to Firebase Hosting.
 *
 * @param siteId - The Firebase Hosting site ID (usually the GCP project ID)
 * @param files - Map of file paths to file contents
 */
export async function deployToHosting(
  siteId: string,
  files: Record<string, string>
): Promise<DeployResult> {
  const baseUrl = `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}`;

  try {
    // Step 1: Create a new version
    console.log(`Creating new hosting version for site: ${siteId}`);
    const createVersionRes = await hostingFetch(`${baseUrl}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        config: {
          rewrites: [
            {
              glob: '**',
              path: '/index.html',
            },
          ],
        },
      }),
    });

    if (!createVersionRes.ok) {
      const err = await createVersionRes.json().catch(() => ({}));
      throw new Error(`Failed to create version: ${err.error?.message || createVersionRes.statusText}`);
    }

    const version = await createVersionRes.json();
    const versionName = version.name; // e.g. "sites/{siteId}/versions/{versionId}"
    console.log(`Created version: ${versionName}`);

    // Step 2: Prepare file hashes (gzipped)
    // Firebase Hosting expects files as a hash map: {"/path": hash_of_gzipped_content}
    const fileHashes: Record<string, string> = {};
    const hashToGzipped: Record<string, Buffer> = {};

    for (const [path, content] of Object.entries(files)) {
      // Normalize path: ensure it starts with /
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const gzipped = gzipContent(content);
      const hash = hashGzipped(gzipped);
      fileHashes[normalizedPath] = hash;
      hashToGzipped[hash] = gzipped;
    }

    // Step 3: Populate files - tell Firebase which files this version contains
    console.log(`Populating ${Object.keys(fileHashes).length} files...`);
    const populateRes = await hostingFetch(`${baseUrl}/${versionName.split('/').slice(-2).join('/')}:populateFiles`, {
      method: 'POST',
      body: JSON.stringify({ files: fileHashes }),
    });

    if (!populateRes.ok) {
      const err = await populateRes.json().catch(() => ({}));
      throw new Error(`Failed to populate files: ${err.error?.message || populateRes.statusText}`);
    }

    const populateData = await populateRes.json();
    const uploadUrl = populateData.uploadUrl;
    const uploadRequiredHashes = populateData.uploadRequiredHashes || [];

    // Step 4: Upload any files that Firebase doesn't already have (gzipped)
    if (uploadRequiredHashes.length > 0 && uploadUrl) {
      console.log(`Uploading ${uploadRequiredHashes.length} new files...`);
      for (const hash of uploadRequiredHashes) {
        const gzipped = hashToGzipped[hash];
        if (!gzipped) continue;

        const uploadRes = await fetch(`${uploadUrl}/${hash}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/octet-stream',
          },
          body: new Uint8Array(gzipped),
        });

        if (!uploadRes.ok) {
          console.error(`Failed to upload file with hash ${hash}: ${uploadRes.statusText}`);
        }
      }
    }

    // Step 5: Finalize the version
    console.log(`Finalizing version...`);
    const versionPath = versionName.split('/').slice(-2).join('/');
    const finalizeRes = await hostingFetch(
      `${baseUrl}/${versionPath}?update_mask=status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'FINALIZED' }),
      }
    );

    if (!finalizeRes.ok) {
      const err = await finalizeRes.json().catch(() => ({}));
      throw new Error(`Failed to finalize version: ${err.error?.message || finalizeRes.statusText}`);
    }

    // Step 6: Create a release to make this version live
    console.log(`Creating release...`);
    const releaseRes = await hostingFetch(
      `${baseUrl}/releases?version_name=${encodeURIComponent(versionName)}`,
      { method: 'POST', body: JSON.stringify({}) }
    );

    if (!releaseRes.ok) {
      const err = await releaseRes.json().catch(() => ({}));
      throw new Error(`Failed to create release: ${err.error?.message || releaseRes.statusText}`);
    }

    const versionId = versionName.split('/').pop();
    const url = `https://${siteId}.web.app`;

    console.log(`Deployed successfully to ${url}`);

    return {
      success: true,
      url,
      versionId,
    };
  } catch (error: any) {
    console.error('Firebase Hosting deployment failed:', error);
    return {
      success: false,
      error: error.message || 'Deployment failed',
    };
  }
}
