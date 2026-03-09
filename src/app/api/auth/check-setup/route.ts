import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAdminDb();
    const usersSnapshot = await db.collection('users').limit(1).get();
    return NextResponse.json({ needsSetup: usersSnapshot.empty });
  } catch {
    return NextResponse.json({ needsSetup: false });
  }
}
