import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { undeleteGcpProject } from '@/lib/gcp/project-manager';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin role
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { projectId } = await params;
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;

    if (project.status !== 'deleted') {
      return NextResponse.json({ error: 'Project is not deleted' }, { status: 400 });
    }

    // Restore GCP project (within 30-day window)
    if (project.gcpProject?.projectId) {
      try {
        await undeleteGcpProject(project.gcpProject.projectId);
      } catch (err: any) {
        return NextResponse.json(
          { error: `Failed to restore GCP project: ${err.message}` },
          { status: 500 }
        );
      }
    }

    // Restore in Firestore
    const now = new Date();
    await projectRef.update({
      status: 'active',
      deletedAt: null,
      updatedAt: now,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to restore project:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to restore project' },
      { status: 500 }
    );
  }
}
