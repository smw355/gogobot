import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { createGcpProject } from '@/lib/gcp/project-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects — Create a new Gogobot project with its own GCP project.
 *
 * 1. Creates the Firestore document (status: active, gcpProject.status: provisioning)
 * 2. Kicks off GCP project creation asynchronously
 * 3. Returns immediately with the project ID so the UI can start
 * 4. Updates Firestore when GCP provisioning completes
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, category } = await request.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    // Create the Firestore project document
    const projectRef = await db.collection('projects').add({
      name: name.trim(),
      category: category || null,
      userId: user.uid,
      status: 'active',
      gcpProject: {
        projectId: '', // Will be filled in after provisioning
        region: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
        status: 'provisioning',
        enabledApis: [],
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    const projectId = projectRef.id;

    // Provision GCP project asynchronously (don't block the response)
    provisionGcpProject(projectId, user.uid, name.trim(), user.email).catch((err) => {
      console.error(`GCP provisioning failed for ${projectId}:`, err);
    });

    return NextResponse.json({ id: projectId });
  } catch (error: any) {
    console.error('Create project error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create project' },
      { status: 500 }
    );
  }
}

/**
 * Provision a GCP project in the background and update Firestore when done.
 */
async function provisionGcpProject(
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
      'gcpProject.billingEnabled': result.billingEnabled ?? false,
      'gcpProject.status': 'ready',
      updatedAt: new Date(),
    });

    console.log(`GCP project provisioned for ${gogobotProjectId}: ${result.gcpProjectId}`);
  } catch (error: any) {
    console.error(`GCP provisioning failed for ${gogobotProjectId}:`, error);

    await projectRef.update({
      'gcpProject.status': 'error',
      'gcpProject.error': error.message || 'Provisioning failed',
      updatedAt: new Date(),
    });
  }
}
