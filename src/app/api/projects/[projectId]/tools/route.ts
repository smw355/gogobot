import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { createGcpProject, enableApi, getGcpProjectStatus, configureStorageCors } from '@/lib/gcp/project-manager';
import { GoogleAuth } from 'google-auth-library';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — GCP operations can be slow

// ─── GCP Request Security ──────────────────────────────────────────────────

/** Patterns that are never allowed in gcpRequest URLs */
const BLOCKED_URL_PATTERNS = [
  /setIamPolicy/i,
  /getIamPolicy/i,
  /\/organizations\//i,
  /\/billingAccounts\//i,
  /\/folders\//i,
  /\/serviceAccounts/i,
  /getAccessToken/i,
  /signBlob/i,
  /signJwt/i,
  /generateAccessToken/i,
  /generateIdToken/i,
  /iamPolicies/i,
  /iamcredentials\.googleapis\.com/i,
];

/**
 * Validate a gcpRequest URL for security:
 * 1. Must be a *.googleapis.com URL
 * 2. Must reference the project's own GCP project ID
 * 3. Must not match any blocked patterns
 */
function validateGcpRequestUrl(url: string, gcpProjectId: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL format';
  }

  if (!parsed.hostname.endsWith('.googleapis.com')) {
    return 'URL must be a *.googleapis.com endpoint';
  }

  if (parsed.protocol !== 'https:') {
    return 'URL must use HTTPS';
  }

  // URL must reference this project's GCP project ID (in path or query)
  const fullUrl = parsed.pathname + parsed.search;
  if (!fullUrl.includes(gcpProjectId) && !parsed.hostname.includes(gcpProjectId)) {
    return `URL must reference this project's GCP project ID (${gcpProjectId}). Use getProjectInfo to get the project ID.`;
  }

  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(url)) {
      return `Blocked: this type of operation is not allowed (matched ${pattern.source})`;
    }
  }

  return null; // Valid
}

// ─── Auth helper for gcpRequest ─────────────────────────────────────────────

let gcpAuth: GoogleAuth | null = null;

function getGcpAuth(): GoogleAuth {
  if (!gcpAuth) {
    const adminKey = process.env.FIREBASE_ADMIN_KEY;
    const scopes = [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/firebase',
    ];
    if (adminKey) {
      const credentials = JSON.parse(adminKey);
      gcpAuth = new GoogleAuth({ credentials, scopes });
    } else {
      gcpAuth = new GoogleAuth({ scopes });
    }
  }
  return gcpAuth;
}

async function getGcpAccessToken(): Promise<string> {
  const auth = getGcpAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

/**
 * POST /api/projects/[projectId]/tools — Execute a server-side GCP tool.
 *
 * Tools that need GCP credentials execute here rather than in the browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const db = getAdminDb();
    const projectDoc = await db.collection('projects').doc(projectId).get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;
    const gcpProjectId = project.gcpProject?.projectId;

    const { tool, args } = await request.json();

    if (!tool || typeof tool !== 'string') {
      return NextResponse.json({ error: 'Tool name is required' }, { status: 400 });
    }

    let result: any;

    switch (tool) {
      case 'getProjectInfo': {
        // Auto-retry provisioning if it previously failed
        if (!gcpProjectId && project.gcpProject?.status === 'error') {
          console.log(`Auto-retrying GCP provisioning for ${projectId}`);
          await db.collection('projects').doc(projectId).update({
            'gcpProject.status': 'provisioning',
            'gcpProject.error': null,
            updatedAt: new Date(),
          });
          // Re-provision in background
          retryProvision(projectId, user.uid, project.name, user.email).catch((err) => {
            console.error(`GCP re-provisioning failed for ${projectId}:`, err);
          });
          result = {
            success: true,
            status: 'provisioning',
            message: 'Cloud project provisioning is being retried. Check back in a moment.',
          };
          break;
        }

        if (!gcpProjectId) {
          result = {
            success: true,
            status: project.gcpProject?.status || 'not provisioned',
            message: 'Cloud project is still being set up.',
          };
        } else {
          const status = await getGcpProjectStatus(gcpProjectId);
          result = {
            success: true,
            gcpProjectId,
            hostingUrl: project.gcpProject?.hostingUrl,
            hostingSiteId: project.gcpProject?.hostingSiteId,
            region: project.gcpProject?.region,
            provisioningStatus: project.gcpProject?.status,
            enabledApis: status.enabledApis || project.gcpProject?.enabledApis || [],
            firebaseConfig: project.gcpProject?.firebaseConfig || null,
            deployment: project.deployment || null,
          };
        }
        break;
      }

      case 'enableApi': {
        if (!gcpProjectId) {
          result = { success: false, error: 'Cloud project not ready yet' };
          break;
        }
        const apiName = args?.apiName;
        if (!apiName) {
          result = { success: false, error: 'apiName is required' };
          break;
        }
        try {
          await enableApi(gcpProjectId, apiName);
          // Update Firestore with newly enabled API
          const currentApis = project.gcpProject?.enabledApis || [];
          if (!currentApis.includes(apiName)) {
            await db.collection('projects').doc(projectId).update({
              'gcpProject.enabledApis': [...currentApis, apiName],
              updatedAt: new Date(),
            });
          }
          // Auto-configure CORS when Cloud Storage is enabled
          if (apiName === 'storage.googleapis.com') {
            try {
              await configureStorageCors(gcpProjectId);
              console.log(`Storage CORS configured for ${gcpProjectId}`);
            } catch (corsErr: any) {
              console.warn(`Failed to configure Storage CORS:`, corsErr.message);
            }
          }
          result = { success: true, message: `Enabled ${apiName}` };
        } catch (err: any) {
          result = { success: false, error: err.message };
        }
        break;
      }

      case 'viewLogs': {
        if (!gcpProjectId) {
          result = { success: false, error: 'Cloud project not ready yet' };
          break;
        }

        try {
          const token = await getGcpAccessToken();

          // Build filter string
          const hours = Math.min(Math.max(args?.hours || 1, 0.1), 24);
          const limit = Math.min(Math.max(args?.limit || 50, 1), 200);
          const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

          const filterParts: string[] = [`timestamp >= "${since}"`];

          if (args?.severity) {
            const validSeverities = ['DEFAULT', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
            const sev = args.severity.toUpperCase();
            if (validSeverities.includes(sev)) {
              filterParts.push(`severity >= ${sev}`);
            }
          }

          if (args?.resourceType) {
            filterParts.push(`resource.type = "${args.resourceType}"`);
          }

          if (args?.query) {
            filterParts.push(args.query);
          }

          const requestBody = {
            resourceNames: [`projects/${gcpProjectId}`],
            filter: filterParts.join('\n'),
            orderBy: 'timestamp desc',
            pageSize: limit,
          };

          const logsResponse = await fetch(
            'https://logging.googleapis.com/v2/entries:list',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
            }
          );

          if (!logsResponse.ok) {
            const errData = await logsResponse.json().catch(() => ({}));
            const errMsg = errData?.error?.message || logsResponse.statusText;

            // Check if Cloud Logging API isn't enabled
            if (logsResponse.status === 403 || errMsg.includes('not been used') || errMsg.includes('PERMISSION_DENIED')) {
              result = {
                success: false,
                error: `Cloud Logging API may not be enabled for this project. Use the enableApi tool to enable "logging.googleapis.com" first.`,
              };
            } else {
              result = { success: false, error: `Cloud Logging API error: ${errMsg}` };
            }
            break;
          }

          const logsData = await logsResponse.json();
          const entries = logsData.entries || [];

          // Format entries into a concise structure
          const logs = entries.map((entry: any) => {
            const message =
              entry.textPayload ||
              entry.jsonPayload?.message ||
              (entry.jsonPayload ? JSON.stringify(entry.jsonPayload) : '') ||
              entry.protoPayload?.status?.message ||
              '';

            return {
              timestamp: entry.timestamp,
              severity: entry.severity || 'DEFAULT',
              message: message.length > 500 ? message.slice(0, 500) + '...' : message,
              resource: entry.resource?.type || 'unknown',
              labels: entry.resource?.labels
                ? Object.fromEntries(
                    Object.entries(entry.resource.labels).filter(
                      ([k]) => ['service_name', 'revision_name', 'function_name', 'site_id'].includes(k)
                    )
                  )
                : {},
              ...(entry.httpRequest ? {
                httpRequest: {
                  method: entry.httpRequest.requestMethod,
                  url: entry.httpRequest.requestUrl,
                  status: entry.httpRequest.status,
                },
              } : {}),
            };
          });

          result = {
            success: true,
            logs,
            count: logs.length,
            filter: filterParts.join(' AND '),
            message: logs.length === 0
              ? `No logs found in the last ${hours} hour(s). The service may not have received any traffic, or Cloud Logging may not be enabled.`
              : `Found ${logs.length} log entries from the last ${hours} hour(s).`,
          };
        } catch (err: any) {
          result = { success: false, error: `Failed to fetch logs: ${err.message}` };
        }
        break;
      }

      case 'getSecrets': {
        const secretsSnapshot = await db
          .collection('projects')
          .doc(projectId)
          .collection('secrets')
          .get();

        const secretNames = secretsSnapshot.docs.map((doc) => doc.id);
        result = {
          success: true,
          secrets: secretNames,
          count: secretNames.length,
          message: secretNames.length === 0
            ? 'No secrets configured. The user can add API keys via the Secrets panel.'
            : `Found ${secretNames.length} secret(s): ${secretNames.join(', ')}. Use __ENV__{NAME}__ placeholders in client-side code — they get replaced at deploy time. Use getSecretValue for server-side use.`,
        };
        break;
      }

      case 'getSecretValue': {
        const secretName = args?.name;
        if (!secretName || typeof secretName !== 'string') {
          result = { success: false, error: 'Secret name is required' };
          break;
        }

        // Check the secret exists in our index
        const secretDoc = await db
          .collection('projects')
          .doc(projectId)
          .collection('secrets')
          .doc(secretName)
          .get();

        if (!secretDoc.exists) {
          result = { success: false, error: `Secret "${secretName}" not found. Use getSecrets to see available secrets.` };
          break;
        }

        try {
          const { smGetSecretValue } = await import('@/app/api/projects/[projectId]/secrets/route');
          const secretId = `gogobot-${projectId}-${secretName}`;
          const value = await smGetSecretValue(secretId);
          result = { success: true, name: secretName, value };
        } catch (err: any) {
          result = { success: false, error: `Failed to retrieve secret: ${err.message}` };
        }
        break;
      }

      case 'listAssets': {
        const assetsSnapshot = await db
          .collection('projects')
          .doc(projectId)
          .collection('assets')
          .orderBy('uploadedAt', 'desc')
          .get();

        const assets = assetsSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            name: data.name,
            url: data.url,
            contentType: data.contentType,
            size: data.size,
          };
        });

        result = {
          success: true,
          assets,
          count: assets.length,
          message: assets.length === 0
            ? 'No assets uploaded. The user can upload images, logos, PDFs, and other files via the paperclip button in chat.'
            : `Found ${assets.length} asset(s). Use the URLs directly in your code (img src, CSS background-image, link href, etc.).`,
        };
        break;
      }

      case 'gcpRequest': {
        if (!gcpProjectId) {
          result = { success: false, error: 'Cloud project not ready yet. Wait for provisioning to complete.' };
          break;
        }

        const { url, method = 'GET', body } = args || {};

        if (!url || typeof url !== 'string') {
          result = { success: false, error: 'url is required' };
          break;
        }

        // Validate URL for security
        const validationError = validateGcpRequestUrl(url, gcpProjectId);
        if (validationError) {
          result = { success: false, error: `Security validation failed: ${validationError}` };
          break;
        }

        const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        const httpMethod = (method || 'GET').toUpperCase();
        if (!allowedMethods.includes(httpMethod)) {
          result = { success: false, error: `Invalid HTTP method: ${method}. Use GET, POST, PUT, PATCH, or DELETE.` };
          break;
        }

        try {
          console.log(`gcpRequest: ${httpMethod} ${url}`);
          const token = await getGcpAccessToken();

          const fetchOptions: RequestInit = {
            method: httpMethod,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          };

          if (body && ['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
          }

          const gcpResponse = await fetch(url, fetchOptions);
          const responseText = await gcpResponse.text();

          let responseData: any;
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }

          // Truncate large responses to prevent context overflow
          const responseStr = JSON.stringify(responseData);
          if (responseStr.length > 10000) {
            responseData = {
              _truncated: true,
              _originalLength: responseStr.length,
              data: JSON.parse(responseStr.slice(0, 10000) + '..."}}'),
            };
            // If truncation causes invalid JSON, just return a summary
            if (typeof responseData.data !== 'object') {
              responseData = {
                _truncated: true,
                _originalLength: responseStr.length,
                message: `Response too large (${responseStr.length} chars). Try a more specific request or add query parameters to limit results.`,
              };
            }
          }

          result = {
            success: gcpResponse.ok,
            status: gcpResponse.status,
            statusText: gcpResponse.statusText,
            data: responseData,
          };

          if (!gcpResponse.ok) {
            console.warn(`gcpRequest failed: ${gcpResponse.status} ${httpMethod} ${url}`, responseData?.error?.message);
            result.error = responseData?.error?.message || gcpResponse.statusText;
          }
        } catch (err: any) {
          result = { success: false, error: err.message };
        }
        break;
      }

      default:
        result = { success: false, error: `Unknown server-side tool: ${tool}` };
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Tool execution error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Tool execution failed' },
      { status: 500 }
    );
  }
}

// ─── Provisioning Retry ─────────────────────────────────────────────────────

async function retryProvision(
  gogobotProjectId: string,
  userId: string,
  projectName: string,
  userEmail?: string
): Promise<void> {
  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(gogobotProjectId);

  try {
    const result = await createGcpProject(gogobotProjectId, userId, projectName, userEmail);

    await projectRef.update({
      'gcpProject.projectId': result.gcpProjectId,
      'gcpProject.projectNumber': result.projectNumber || null,
      'gcpProject.hostingSiteId': result.hostingSiteId || null,
      'gcpProject.hostingUrl': result.hostingUrl || null,
      'gcpProject.enabledApis': result.enabledApis,
      'gcpProject.userFolderId': result.userFolderId || null,
      'gcpProject.firebaseAppId': result.firebaseAppId || null,
      'gcpProject.firebaseConfig': result.firebaseConfig || null,
      'gcpProject.status': 'ready',
      'gcpProject.error': null,
      updatedAt: new Date(),
    });

    console.log(`GCP project re-provisioned for ${gogobotProjectId}: ${result.gcpProjectId}`);
  } catch (error: any) {
    console.error(`GCP re-provisioning failed for ${gogobotProjectId}:`, error);

    await projectRef.update({
      'gcpProject.status': 'error',
      'gcpProject.error': error.message || 'Re-provisioning failed',
      updatedAt: new Date(),
    });
  }
}
