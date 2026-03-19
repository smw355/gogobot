import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';
import { gcpFetch } from '@/lib/gcp/project-manager';
import { logger } from '@/lib/logger';

// In-memory cache (15 min TTL)
let cachedResult: { data: any; timestamp: number; range: string } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

const PLATFORM_PROJECT = process.env.GOOGLE_CLOUD_PROJECT_ID || 'gogobot-dev-6029b';
const BQ_DATASET = 'billing_export';

/**
 * Run a BigQuery SQL query using the REST API and return rows.
 */
async function bqQuery(sql: string): Promise<any[]> {
  const res = await gcpFetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PLATFORM_PROJECT}/queries`,
    {
      method: 'POST',
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        timeoutMs: 30000,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`BigQuery query failed: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  if (!data.rows) return [];

  const fields = data.schema?.fields || [];
  return data.rows.map((row: any) =>
    Object.fromEntries(
      row.f.map((cell: any, i: number) => [fields[i]?.name || `col${i}`, cell.v])
    )
  );
}

/**
 * Discover the billing export table name by listing tables in the dataset.
 * Table names follow: gcp_billing_export_v1_{BILLING_ACCOUNT_ID_NO_DASHES}
 */
async function findBillingTable(): Promise<string | null> {
  const res = await gcpFetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PLATFORM_PROJECT}/datasets/${BQ_DATASET}/tables?maxResults=20`
  );

  if (!res.ok) return null;

  const data = await res.json();
  const tables = data.tables || [];
  // Prefer standard export table
  const standard = tables.find((t: any) =>
    t.tableReference?.tableId?.startsWith('gcp_billing_export_v1_')
  );
  if (standard) return standard.tableReference.tableId;

  // Fall back to detailed
  const detailed = tables.find((t: any) =>
    t.tableReference?.tableId?.startsWith('gcp_billing_export_resource_v1_')
  );
  if (detailed) return detailed.tableReference.tableId;

  return null;
}

export async function GET(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const billingAccountId = process.env.GCP_BILLING_ACCOUNT_ID;
  if (!billingAccountId) {
    return NextResponse.json({ error: 'GCP_BILLING_ACCOUNT_ID not configured' }, { status: 500 });
  }

  const range = request.nextUrl.searchParams.get('range') || '30d';

  // Check cache
  if (cachedResult && cachedResult.range === range && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedResult.data);
  }

  try {
    const db = getAdminDb();

    // Build Gogobot project map from Firestore
    const projectsSnapshot = await db.collection('projects').get();
    const gogobotByGcpId: Record<string, {
      id: string;
      name: string;
      userId: string;
    }> = {};

    for (const doc of projectsSnapshot.docs) {
      const data = doc.data();
      const gcpId = data.gcpProject?.projectId;
      if (gcpId) {
        gogobotByGcpId[gcpId] = {
          id: doc.id,
          name: data.name || 'Untitled',
          userId: data.userId,
        };
      }
    }

    // Get user emails
    const userIds = new Set(Object.values(gogobotByGcpId).map(p => p.userId));
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

    // Fetch billing-linked projects
    let billingProjectCount = 0;
    let gogobotLinked = 0;
    try {
      const billingRes = await gcpFetch(
        `https://cloudbilling.googleapis.com/v1/billingAccounts/${billingAccountId}/projects`
      );
      if (billingRes.ok) {
        const billingData = await billingRes.json();
        const projects = billingData.projectBillingInfo || [];
        billingProjectCount = projects.length;
        gogobotLinked = projects.filter((p: any) => gogobotByGcpId[p.projectId]).length;
      }
    } catch (e) {
      logger.warn('Failed to fetch billing projects list', { error: String(e) });
    }

    // Try BigQuery cost data
    let costData: {
      perProject: Array<{
        gcpProjectId: string;
        gogobotName: string | null;
        userEmail: string | null;
        totalCost: number;
        services: Array<{ service: string; cost: number }>;
      }>;
      totalCost: number;
      dateRange: { start: string; end: string };
    } | null = null;

    let bqStatus: 'ok' | 'no_table' | 'no_data' | 'error' = 'no_table';

    try {
      const tableName = await findBillingTable();

      if (tableName) {
        const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
        const fullTable = `\`${PLATFORM_PROJECT}.${BQ_DATASET}.${tableName}\``;

        // Per-project + service cost breakdown
        const rows = await bqQuery(`
          SELECT
            project.id AS project_id,
            service.description AS service_name,
            ROUND(SUM(cost), 2) AS cost,
            ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS credits
          FROM ${fullTable}
          WHERE _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
            OR export_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
          GROUP BY project.id, service.description
          HAVING SUM(cost) > 0.001
          ORDER BY cost DESC
        `);

        if (rows.length > 0) {
          bqStatus = 'ok';

          // Aggregate per project
          const projectCosts: Record<string, {
            totalCost: number;
            services: Record<string, number>;
          }> = {};

          let totalCost = 0;

          for (const row of rows) {
            const pid = row.project_id || 'unknown';
            const cost = parseFloat(row.cost) || 0;
            const credits = parseFloat(row.credits) || 0;
            const net = cost + credits; // credits are negative
            const service = row.service_name || 'Other';

            if (!projectCosts[pid]) {
              projectCosts[pid] = { totalCost: 0, services: {} };
            }
            projectCosts[pid].totalCost += net;
            projectCosts[pid].services[service] = (projectCosts[pid].services[service] || 0) + net;
            totalCost += net;
          }

          const now = new Date();
          const start = new Date(now.getTime() - days * 86400000);

          costData = {
            totalCost: Math.round(totalCost * 100) / 100,
            dateRange: {
              start: start.toISOString().split('T')[0],
              end: now.toISOString().split('T')[0],
            },
            perProject: Object.entries(projectCosts)
              .map(([gcpProjectId, data]) => {
                const gogobot = gogobotByGcpId[gcpProjectId];
                return {
                  gcpProjectId,
                  gogobotName: gogobot?.name || null,
                  userEmail: gogobot ? (userEmails[gogobot.userId] || null) : null,
                  totalCost: Math.round(data.totalCost * 100) / 100,
                  services: Object.entries(data.services)
                    .map(([service, cost]) => ({
                      service,
                      cost: Math.round(cost * 100) / 100,
                    }))
                    .filter(s => Math.abs(s.cost) > 0.001)
                    .sort((a, b) => b.cost - a.cost),
                };
              })
              .sort((a, b) => b.totalCost - a.totalCost),
          };
        } else {
          bqStatus = 'no_data';
        }
      }
    } catch (e: any) {
      bqStatus = 'error';
      logger.warn('BigQuery cost query failed', { error: e.message });
    }

    const result = {
      billingAccountId,
      billingProjectCount,
      gogobotLinked,
      range,
      bqStatus,
      costData,
      setupGuide: bqStatus !== 'ok' ? {
        no_table: 'BigQuery billing export not configured. Enable it in Cloud Console: Billing > Billing Export > Standard usage cost > select project and dataset "billing_export".',
        no_data: 'Billing export is configured but no cost data yet. Data usually appears within a few hours of enabling export.',
        error: 'Could not query BigQuery. Ensure the service account has roles/bigquery.dataViewer on the billing_export dataset.',
      }[bqStatus] : undefined,
    };

    cachedResult = { data: result, timestamp: Date.now(), range };
    return NextResponse.json(result);
  } catch (error: any) {
    logger.error('Admin costs API error', { error: error.message });
    return NextResponse.json(
      { error: error.message || 'Failed to fetch billing data' },
      { status: 500 }
    );
  }
}
