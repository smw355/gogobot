import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { GoogleAuth } from 'google-auth-library';

export const dynamic = 'force-dynamic';

const SECRET_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Secret Manager helpers ─────────────────────────────────────────────────

const PLATFORM_PROJECT = process.env.GOOGLE_CLOUD_PROJECT_ID!;
const SM_BASE = `https://secretmanager.googleapis.com/v1`;

/** Secret Manager secret ID for a given project + secret name */
function smSecretId(projectId: string, name: string): string {
  return `gogobot-${projectId}-${name}`;
}

let smAuth: GoogleAuth | null = null;

function getSmAuth(): GoogleAuth {
  if (!smAuth) {
    const adminKey = process.env.FIREBASE_ADMIN_KEY;
    const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
    if (adminKey) {
      const credentials = JSON.parse(adminKey);
      smAuth = new GoogleAuth({ credentials, scopes });
    } else {
      smAuth = new GoogleAuth({ scopes });
    }
  }
  return smAuth;
}

async function smAccessToken(): Promise<string> {
  const auth = getSmAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get access token for Secret Manager');
  return token.token;
}

/** Create a secret (the container) and add its first version */
async function smCreateSecret(secretId: string, value: string): Promise<void> {
  const token = await smAccessToken();

  // Create the secret resource
  const createRes = await fetch(
    `${SM_BASE}/projects/${PLATFORM_PROJECT}/secrets?secretId=${secretId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ replication: { automatic: {} } }),
    }
  );

  // 409 = already exists — that's fine, we'll add a new version
  if (!createRes.ok && createRes.status !== 409) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Secret Manager create failed: ${err?.error?.message || createRes.statusText}`);
  }

  // Add a version with the actual value
  const addRes = await fetch(
    `${SM_BASE}/projects/${PLATFORM_PROJECT}/secrets/${secretId}:addVersion`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { data: Buffer.from(value).toString('base64') } }),
    }
  );

  if (!addRes.ok) {
    const err = await addRes.json().catch(() => ({}));
    throw new Error(`Secret Manager addVersion failed: ${err?.error?.message || addRes.statusText}`);
  }
}

/** Delete a secret entirely */
async function smDeleteSecret(secretId: string): Promise<void> {
  const token = await smAccessToken();
  const res = await fetch(
    `${SM_BASE}/projects/${PLATFORM_PROJECT}/secrets/${secretId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  // 404 = already gone — that's fine
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Secret Manager delete failed: ${err?.error?.message || res.statusText}`);
  }
}

/** Read the latest version of a secret */
export async function smGetSecretValue(secretId: string): Promise<string> {
  const token = await smAccessToken();
  const res = await fetch(
    `${SM_BASE}/projects/${PLATFORM_PROJECT}/secrets/${secretId}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Secret Manager access failed: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return Buffer.from(data.payload.data, 'base64').toString('utf-8');
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
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

  // Firestore is the index — never returns values
  const secretsSnapshot = await db
    .collection('projects')
    .doc(projectId)
    .collection('secrets')
    .get();

  const secrets = secretsSnapshot.docs.map((doc) => ({
    name: doc.id,
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));

  return NextResponse.json({ secrets });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
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

  const { name, value } = await request.json();

  if (!name || typeof name !== 'string' || !SECRET_NAME_REGEX.test(name)) {
    return NextResponse.json(
      { error: 'Invalid secret name. Use letters, numbers, and underscores only (e.g. STRIPE_KEY).' },
      { status: 400 }
    );
  }

  if (!value || typeof value !== 'string') {
    return NextResponse.json({ error: 'Secret value is required' }, { status: 400 });
  }

  try {
    // Store the actual value in Secret Manager
    const secretId = smSecretId(projectId, name);
    await smCreateSecret(secretId, value);

    // Store name + metadata in Firestore (no value!)
    const now = new Date();
    const secretRef = db.collection('projects').doc(projectId).collection('secrets').doc(name);
    const existing = await secretRef.get();

    await secretRef.set({
      name,
      secretManagerId: secretId,
      createdAt: existing.exists ? existing.data()?.createdAt : now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Failed to create secret:', err);
    return NextResponse.json({ error: err.message || 'Failed to save secret' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
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

  const { name } = await request.json();

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Secret name is required' }, { status: 400 });
  }

  try {
    // Delete from Secret Manager
    const secretId = smSecretId(projectId, name);
    await smDeleteSecret(secretId);

    // Remove from Firestore index
    await db.collection('projects').doc(projectId).collection('secrets').doc(name).delete();

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete secret:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete secret' }, { status: 500 });
  }
}
