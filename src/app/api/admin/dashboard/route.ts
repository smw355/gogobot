import { NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getAdminDb();

  // Fetch users and projects in parallel
  const [usersSnapshot, projectsSnapshot] = await Promise.all([
    db.collection('users').get(),
    db.collection('projects').get(),
  ]);

  // Build user map
  const userMap: Record<string, {
    email: string;
    displayName: string;
    role: string;
    createdAt: string | null;
    lastLoginAt: string | null;
  }> = {};

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    userMap[doc.id] = {
      email: data.email || '',
      displayName: data.displayName || '',
      role: data.role || 'user',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString() || null,
    };
  }

  // Aggregate project data per user
  const perUser: Record<string, {
    email: string;
    displayName: string;
    role: string;
    projectCount: number;
    deploymentCount: number;
    enabledApisTotal: number;
    lastActive: string | null;
    projects: Array<{
      id: string;
      name: string;
      gcpProjectId: string | null;
      status: string;
      gcpStatus: string | null;
      enabledApis: string[];
      lastDeployed: string | null;
      hostingUrl: string | null;
      createdAt: string | null;
    }>;
  }> = {};

  // Aggregate stats
  let totalDeployments = 0;
  const statusCounts: Record<string, number> = {};
  const gcpStatusCounts: Record<string, number> = {};
  const errorProjects: Array<{ id: string; name: string; userEmail: string; error: string | null }> = [];
  const recentProjects: Array<{ id: string; name: string; userEmail: string; createdAt: string | null }> = [];

  for (const doc of projectsSnapshot.docs) {
    const data = doc.data();
    const userId = data.userId;
    const status = data.status || 'unknown';
    const gcpStatus = data.gcpProject?.status || null;

    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (gcpStatus) {
      gcpStatusCounts[gcpStatus] = (gcpStatusCounts[gcpStatus] || 0) + 1;
    }

    const hasDeployment = !!data.deployment?.url;
    if (hasDeployment) totalDeployments++;

    // Initialize user entry
    if (!perUser[userId]) {
      const u = userMap[userId] || { email: 'Unknown', displayName: '', role: 'user', createdAt: null, lastLoginAt: null };
      perUser[userId] = {
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        projectCount: 0,
        deploymentCount: 0,
        enabledApisTotal: 0,
        lastActive: u.lastLoginAt,
        projects: [],
      };
    }

    const enabledApis = data.gcpProject?.enabledApis || [];
    perUser[userId].projectCount++;
    if (hasDeployment) perUser[userId].deploymentCount++;
    perUser[userId].enabledApisTotal += enabledApis.length;

    const updatedAt = data.updatedAt?.toDate?.()?.toISOString() || null;
    if (updatedAt && (!perUser[userId].lastActive || updatedAt > perUser[userId].lastActive!)) {
      perUser[userId].lastActive = updatedAt;
    }

    const projectEntry = {
      id: doc.id,
      name: data.name || 'Untitled',
      gcpProjectId: data.gcpProject?.projectId || null,
      status,
      gcpStatus,
      enabledApis,
      lastDeployed: data.deployment?.deployedAt?.toDate?.()?.toISOString() || null,
      hostingUrl: data.deployment?.url || data.gcpProject?.hostingUrl || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    };

    perUser[userId].projects.push(projectEntry);

    // Track error projects
    if (gcpStatus === 'error') {
      errorProjects.push({
        id: doc.id,
        name: data.name || 'Untitled',
        userEmail: userMap[userId]?.email || 'Unknown',
        error: data.gcpProject?.error || null,
      });
    }

    // Track recent projects
    recentProjects.push({
      id: doc.id,
      name: data.name || 'Untitled',
      userEmail: userMap[userId]?.email || 'Unknown',
      createdAt: projectEntry.createdAt,
    });
  }

  // Sort recent projects by creation date (newest first), take top 10
  recentProjects.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Include users with zero projects
  for (const [userId, userData] of Object.entries(userMap)) {
    if (!perUser[userId]) {
      perUser[userId] = {
        email: userData.email,
        displayName: userData.displayName,
        role: userData.role,
        projectCount: 0,
        deploymentCount: 0,
        enabledApisTotal: 0,
        lastActive: userData.lastLoginAt,
        projects: [],
      };
    }
  }

  return NextResponse.json({
    summary: {
      totalUsers: usersSnapshot.size,
      totalProjects: projectsSnapshot.size,
      activeProjects: (statusCounts['active'] || 0) + (statusCounts['deployed'] || 0),
      totalDeployments,
      statusCounts,
      gcpStatusCounts,
    },
    users: Object.entries(perUser)
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.projectCount - a.projectCount),
    errorProjects,
    recentProjects: recentProjects.slice(0, 10),
  });
}
