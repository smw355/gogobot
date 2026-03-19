import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';
import { gcpFetch } from '@/lib/gcp/project-manager';
import { logger } from '@/lib/logger';

// Simple in-memory cache (15 min TTL)
let cachedResult: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const billingAccountId = process.env.GCP_BILLING_ACCOUNT_ID;
  if (!billingAccountId) {
    return NextResponse.json({ error: 'GCP_BILLING_ACCOUNT_ID not configured' }, { status: 500 });
  }

  // Check cache
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedResult.data);
  }

  try {
    const db = getAdminDb();

    // Fetch billing projects from GCP and Gogobot projects from Firestore in parallel
    const [billingRes, projectsSnapshot] = await Promise.all([
      gcpFetch(
        `https://cloudbilling.googleapis.com/v1/billingAccounts/${billingAccountId}/projects`
      ),
      db.collection('projects').get(),
    ]);

    // Build a map of Gogobot projects by GCP project ID for cross-referencing
    const gogobotByGcpId: Record<string, {
      id: string;
      name: string;
      userId: string;
      status: string;
    }> = {};

    for (const doc of projectsSnapshot.docs) {
      const data = doc.data();
      const gcpId = data.gcpProject?.projectId;
      if (gcpId) {
        gogobotByGcpId[gcpId] = {
          id: doc.id,
          name: data.name || 'Untitled',
          userId: data.userId,
          status: data.gcpProject?.status || 'unknown',
        };
      }
    }

    // Parse billing projects
    let billingProjects: Array<{
      gcpProjectId: string;
      billingEnabled: boolean;
      gogobotProjectId: string | null;
      gogobotProjectName: string | null;
      userId: string | null;
    }> = [];

    if (billingRes.ok) {
      const billingData = await billingRes.json();
      const projects = billingData.projectBillingInfo || [];

      for (const p of projects) {
        // projectId format: "projects/12345" or just "12345", billingAccountName format
        const gcpProjectId = p.projectId || '';
        const gogobot = gogobotByGcpId[gcpProjectId] || null;

        billingProjects.push({
          gcpProjectId,
          billingEnabled: p.billingEnabled || false,
          gogobotProjectId: gogobot?.id || null,
          gogobotProjectName: gogobot?.name || null,
          userId: gogobot?.userId || null,
        });
      }
    } else {
      const errBody = await billingRes.text().catch(() => '');
      logger.warn('Failed to fetch billing projects', {
        status: billingRes.status,
        error: errBody.slice(0, 200),
      } as any);
    }

    // Get user emails for display
    const userIds = new Set(billingProjects.map(p => p.userId).filter(Boolean) as string[]);
    const userEmails: Record<string, string> = {};
    if (userIds.size > 0) {
      const userDocs = await Promise.all(
        Array.from(userIds).map(uid => db.collection('users').doc(uid).get())
      );
      for (const doc of userDocs) {
        if (doc.exists) {
          userEmails[doc.id] = doc.data()?.email || '';
        }
      }
    }

    // Group by user
    const perUser: Record<string, {
      email: string;
      projectCount: number;
      billingEnabled: number;
    }> = {};

    for (const bp of billingProjects) {
      if (bp.userId) {
        if (!perUser[bp.userId]) {
          perUser[bp.userId] = {
            email: userEmails[bp.userId] || 'Unknown',
            projectCount: 0,
            billingEnabled: 0,
          };
        }
        perUser[bp.userId].projectCount++;
        if (bp.billingEnabled) perUser[bp.userId].billingEnabled++;
      }
    }

    const result = {
      billingAccountId,
      totalBillingProjects: billingProjects.length,
      gogobotLinked: billingProjects.filter(p => p.gogobotProjectId).length,
      unlinked: billingProjects.filter(p => !p.gogobotProjectId).length,
      billingProjects: billingProjects.map(p => ({
        ...p,
        userEmail: p.userId ? (userEmails[p.userId] || null) : null,
      })),
      perUser: Object.entries(perUser)
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.projectCount - a.projectCount),
      note: 'For detailed per-project cost breakdown, enable BigQuery billing export.',
    };

    // Cache the result
    cachedResult = { data: result, timestamp: Date.now() };

    return NextResponse.json(result);
  } catch (error: any) {
    logger.error('Admin costs API error', { error: error.message });
    return NextResponse.json(
      { error: error.message || 'Failed to fetch billing data' },
      { status: 500 }
    );
  }
}
