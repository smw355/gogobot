import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { GoogleAuth } from 'google-auth-library';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/x-icon',
  'application/pdf',
  'font/woff', 'font/woff2', 'font/ttf', 'application/font-woff', 'application/font-woff2',
  'application/json', 'text/csv',
]);

// Also allow by extension for cases where MIME type isn't set correctly
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.woff', '.woff2', '.ttf', '.json', '.csv',
]);

let gcsAuth: GoogleAuth | null = null;

function getGcsAuth(): GoogleAuth {
  if (!gcsAuth) {
    const adminKey = process.env.FIREBASE_ADMIN_KEY;
    const scopes = ['https://www.googleapis.com/auth/devstorage.full_control'];
    if (adminKey) {
      gcsAuth = new GoogleAuth({ credentials: JSON.parse(adminKey), scopes });
    } else {
      gcsAuth = new GoogleAuth({ scopes });
    }
  }
  return gcsAuth;
}

async function getGcsToken(): Promise<string> {
  const auth = getGcsAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCS access token');
  return token.token;
}

function getBucketName(): string {
  return process.env.GCP_ASSETS_BUCKET || `${process.env.GOOGLE_CLOUD_PROJECT_ID}-assets`;
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^\.+/, '');  // no leading dots
}

async function ensureBucket(token: string): Promise<void> {
  const bucket = getBucketName();
  const platformProject = process.env.GOOGLE_CLOUD_PROJECT_ID;

  // Check if bucket exists
  const checkRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (checkRes.ok) return; // Bucket exists

  if (checkRes.status !== 404) {
    const err = await checkRes.text();
    throw new Error(`Failed to check bucket: ${err}`);
  }

  // Create bucket
  console.log(`Creating assets bucket: ${bucket}`);
  const createRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b?project=${platformProject}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: bucket,
        location: 'US',
        iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create bucket: ${err}`);
  }

  // Set public read access
  const iamRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const currentIam = iamRes.ok ? await iamRes.json() : { bindings: [] };

  const bindings = [
    ...(currentIam.bindings || []),
    { role: 'roles/storage.objectViewer', members: ['allUsers'] },
  ];

  await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/iam`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bindings }),
  });

  console.log(`Assets bucket created and made public: ${bucket}`);
}

// POST — Upload asset
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

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 400 }
      );
    }

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `File type not allowed. Supported: images, PDFs, fonts, JSON, CSV.` },
        { status: 400 }
      );
    }

    const token = await getGcsToken();
    await ensureBucket(token);

    const bucket = getBucketName();
    const sanitized = sanitizeFilename(file.name);
    const filename = sanitized || `file-${Date.now()}`;

    // Check for duplicate, append timestamp if needed
    const existingDoc = await db.collection('projects').doc(projectId).collection('assets').doc(filename).get();
    const finalFilename = existingDoc.exists
      ? `${filename.replace(/(\.[^.]+)$/, '')}-${Date.now()}${ext}`
      : filename;

    const storagePath = `${projectId}/${finalFilename}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Upload to Cloud Storage
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${err}`);
    }

    const publicUrl = `https://storage.googleapis.com/${bucket}/${storagePath}`;

    // Save metadata to Firestore
    await db.collection('projects').doc(projectId).collection('assets').doc(finalFilename).set({
      name: finalFilename,
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      url: publicUrl,
      storagePath,
      uploadedBy: user.uid,
      uploadedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      filename: finalFilename,
      url: publicUrl,
      contentType: file.type,
      size: file.size,
    });
  } catch (error: any) {
    console.error('Asset upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    );
  }
}

// GET — List assets
export async function GET(
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
        contentType: data.contentType,
        size: data.size,
        url: data.url,
        uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || null,
      };
    });

    return NextResponse.json({ assets });
  } catch (error: any) {
    console.error('List assets error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list assets' },
      { status: 500 }
    );
  }
}

// DELETE — Delete asset
export async function DELETE(
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

    const { filename } = await request.json();
    if (!filename) {
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    const assetDoc = await db.collection('projects').doc(projectId).collection('assets').doc(filename).get();
    if (!assetDoc.exists) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const assetData = assetDoc.data()!;

    // Delete from Cloud Storage
    try {
      const token = await getGcsToken();
      const bucket = getBucketName();
      const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(assetData.storagePath)}`;
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Failed to delete from Cloud Storage:', err);
      // Continue to delete Firestore record anyway
    }

    // Delete Firestore metadata
    await db.collection('projects').doc(projectId).collection('assets').doc(filename).delete();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete asset error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete asset' },
      { status: 500 }
    );
  }
}
