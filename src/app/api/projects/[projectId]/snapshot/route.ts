import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';

// GET /api/projects/[projectId]/snapshot - Get the latest snapshot
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

    // Verify project ownership
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get the latest snapshot
    const snapshotsSnapshot = await db
      .collection('projects')
      .doc(projectId)
      .collection('snapshots')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshotsSnapshot.empty) {
      return NextResponse.json({ error: 'No snapshot found' }, { status: 404 });
    }

    const snapshot = snapshotsSnapshot.docs[0].data();
    return NextResponse.json({ files: snapshot.files });
  } catch (error: any) {
    console.error('Get snapshot error:', error);
    return NextResponse.json({ error: error.message || 'Failed to get snapshot' }, { status: 500 });
  }
}

// POST /api/projects/[projectId]/snapshot - Save a snapshot
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
    const { files } = await request.json();
    const db = getAdminDb();

    // Verify project ownership
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Save snapshot
    await db
      .collection('projects')
      .doc(projectId)
      .collection('snapshots')
      .add({
        files,
        createdAt: new Date(),
      });

    // Update project timestamp
    await db.collection('projects').doc(projectId).update({
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save snapshot error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save snapshot' }, { status: 500 });
  }
}
