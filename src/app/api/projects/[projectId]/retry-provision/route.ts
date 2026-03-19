import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { createGcpProject } from '@/lib/gcp/project-manager';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/projects/[projectId]/retry-provision
 * Retry GCP provisioning for a project that failed.
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
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;

    // Only retry if status is 'error'
    if (project.gcpProject?.status !== 'error') {
      return NextResponse.json(
        { error: `Cannot retry: project status is "${project.gcpProject?.status}", not "error"` },
        { status: 400 }
      );
    }

    // Mark as provisioning immediately
    await projectRef.update({
      'gcpProject.status': 'provisioning',
      'gcpProject.error': null,
      updatedAt: new Date(),
    });

    // Run provisioning in background
    provisionInBackground(projectId, user.uid, project.name, user.email).catch((err) => {
      console.error(`Retry provisioning failed for ${projectId}:`, err);
    });

    return NextResponse.json({ success: true, message: 'Provisioning retry started' });
  } catch (error: any) {
    console.error('Retry provision error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry provisioning' },
      { status: 500 }
    );
  }
}

async function provisionInBackground(
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
