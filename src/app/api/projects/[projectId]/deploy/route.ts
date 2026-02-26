import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { deployToHosting } from '@/lib/gcp/firebase-hosting';

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

    // Check GCP project is ready
    if (!project.gcpProject?.hostingSiteId) {
      return NextResponse.json(
        { error: 'Cloud infrastructure is still being set up. Please wait a moment and try again.' },
        { status: 400 }
      );
    }

    if (project.gcpProject?.status !== 'ready') {
      return NextResponse.json(
        { error: `Cloud project is ${project.gcpProject?.status || 'not ready'}. Cannot deploy yet.` },
        { status: 400 }
      );
    }

    // Get files from request body or from latest snapshot
    const body = await request.json().catch(() => ({}));
    let files = body.files;

    if (!files || Object.keys(files).length === 0) {
      const snapshotsRef = projectRef.collection('snapshots');
      const latestSnapshot = await snapshotsRef
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!latestSnapshot.empty) {
        files = latestSnapshot.docs[0].data().files || {};
      }
    }

    if (!files || Object.keys(files).length === 0) {
      return NextResponse.json(
        { error: 'No files to deploy. Build something first!' },
        { status: 400 }
      );
    }

    // Ensure we have an index.html
    if (!files['index.html'] && !files['public/index.html']) {
      return NextResponse.json(
        { error: 'No index.html found. Your project needs an index.html file.' },
        { status: 400 }
      );
    }

    // Update project status
    await projectRef.update({
      status: 'deploying',
      updatedAt: new Date(),
    });

    try {
      // Deploy to the project's own Firebase Hosting site
      const deployResult = await deployToHosting(
        project.gcpProject.hostingSiteId,
        files
      );

      if (deployResult.success) {
        const deployUrl = deployResult.url || project.gcpProject.hostingUrl;

        await projectRef.update({
          status: 'deployed',
          deployment: {
            url: deployUrl,
            deployedAt: new Date(),
          },
          updatedAt: new Date(),
        });

        // Save deployment history
        await projectRef.collection('deployments').add({
          url: deployUrl,
          versionId: deployResult.versionId,
          deployedAt: new Date(),
          deployedBy: user.uid,
        });

        return NextResponse.json({
          success: true,
          url: deployUrl,
          message: `Deployed to ${deployUrl}`,
        });
      } else {
        await projectRef.update({
          status: 'error',
          updatedAt: new Date(),
        });

        return NextResponse.json(
          { error: deployResult.error || 'Deployment failed' },
          { status: 500 }
        );
      }
    } catch (deployError: any) {
      await projectRef.update({
        status: 'error',
        updatedAt: new Date(),
      });

      throw deployError;
    }
  } catch (error: any) {
    console.error('Deploy error:', error);
    return NextResponse.json(
      { error: error.message || 'Deployment failed' },
      { status: 500 }
    );
  }
}

// GET /api/projects/[projectId]/deploy - Get deployment status
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

    const project = projectDoc.data()!;

    return NextResponse.json({
      status: project.status,
      deployment: project.deployment || null,
      gcpProject: project.gcpProject || null,
    });
  } catch (error: any) {
    console.error('Get deployment status error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get deployment status' },
      { status: 500 }
    );
  }
}
