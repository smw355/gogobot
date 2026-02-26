import { NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getAdminDb();

  // Get all projects
  const projectsSnapshot = await db.collection('projects')
    .orderBy('updatedAt', 'desc')
    .get();

  // Collect unique user IDs
  const userIds = new Set<string>();
  for (const doc of projectsSnapshot.docs) {
    userIds.add(doc.data().userId);
  }

  // Batch-fetch user docs
  const userMap: Record<string, { displayName: string; email: string }> = {};
  if (userIds.size > 0) {
    const userDocs = await Promise.all(
      Array.from(userIds).map(uid => db.collection('users').doc(uid).get())
    );
    for (const userDoc of userDocs) {
      if (userDoc.exists) {
        const data = userDoc.data()!;
        userMap[userDoc.id] = {
          displayName: data.displayName || '',
          email: data.email || '',
        };
      }
    }
  }

  const projects = projectsSnapshot.docs.map(doc => {
    const data = doc.data();
    const owner = userMap[data.userId] || { displayName: 'Unknown', email: '' };

    return {
      id: doc.id,
      name: data.name,
      userId: data.userId,
      userName: owner.displayName,
      userEmail: owner.email,
      status: data.status,
      gcpStatus: data.gcpProject?.status || null,
      deploymentUrl: data.deployment?.url || null,
      createdAt: data.createdAt?.toDate?.() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
      deletedAt: data.deletedAt?.toDate?.() || data.deletedAt || null,
    };
  });

  return NextResponse.json({ projects });
}
