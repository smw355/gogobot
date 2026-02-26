import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { deleteGcpProject } from '@/lib/gcp/project-manager';

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
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;

    if (project.status === 'deleted') {
      return NextResponse.json({ error: 'Project is already deleted' }, { status: 400 });
    }

    // Request GCP project deletion (30-day recovery window)
    if (project.gcpProject?.projectId) {
      try {
        await deleteGcpProject(project.gcpProject.projectId);
      } catch (err: any) {
        console.error('Failed to delete GCP project:', err.message);
        // Continue with soft-delete even if GCP deletion fails —
        // the GCP project may already be deleted or not yet provisioned
      }
    }

    // Soft-delete: mark as deleted in Firestore
    const now = new Date();
    await projectRef.update({
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete project:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete project' },
      { status: 500 }
    );
  }
}
