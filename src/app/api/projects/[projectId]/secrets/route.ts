import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';

export const dynamic = 'force-dynamic';

const SECRET_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

  const now = new Date();
  const secretRef = db.collection('projects').doc(projectId).collection('secrets').doc(name);
  const existing = await secretRef.get();

  await secretRef.set({
    name,
    value,
    createdAt: existing.exists ? existing.data()?.createdAt : now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true });
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

  await db.collection('projects').doc(projectId).collection('secrets').doc(name).delete();

  return NextResponse.json({ success: true });
}
