import { NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getAdminDb();
  const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();

  const users = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
      disabled: data.disabled || false,
      createdAt: data.createdAt?.toDate?.() || data.createdAt,
      lastLoginAt: data.lastLoginAt?.toDate?.() || data.lastLoginAt,
    };
  });

  return NextResponse.json({ users });
}
