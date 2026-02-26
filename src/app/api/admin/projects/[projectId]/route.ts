import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { projectId } = await params;
  const { status, name } = await request.json();

  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(projectId);
  const projectDoc = await projectRef.get();

  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const update: Record<string, any> = { updatedAt: new Date() };

  if (status !== undefined) {
    const validStatuses = ['active', 'deploying', 'deployed', 'error', 'deleted'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = status;
    if (status === 'deleted') {
      update.deletedAt = new Date();
    }
    if (status === 'active' && projectDoc.data()?.status === 'deleted') {
      update.deletedAt = null;
    }
  }

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Valid name required' }, { status: 400 });
    }
    update.name = name.trim();
  }

  await projectRef.update(update);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { projectId } = await params;
  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(projectId);
  const projectDoc = await projectRef.get();

  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  await projectRef.update({
    status: 'deleted',
    deletedAt: new Date(),
    updatedAt: new Date(),
  });

  return NextResponse.json({ success: true });
}
