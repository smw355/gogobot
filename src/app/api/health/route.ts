import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — Health check for Cloud Run liveness/readiness probes.
 * Returns 200 if the app is running and Firestore is reachable.
 */
export async function GET() {
  const start = Date.now();
  let firestoreOk = false;

  try {
    // Quick Firestore connectivity check (read a lightweight doc)
    const db = getAdminDb();
    await Promise.race([
      db.collection('config').doc('instance').get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    firestoreOk = true;
  } catch {
    // Firestore unreachable — still return 200 so Cloud Run doesn't restart
    // the container for a transient Firestore issue, but flag it in response
  }

  return NextResponse.json({
    status: firestoreOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
    checks: {
      firestore: firestoreOk ? 'ok' : 'unreachable',
    },
  });
}
