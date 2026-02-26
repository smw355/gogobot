import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;
  const { role, disabled } = await request.json();

  // Prevent admin from modifying themselves
  if (userId === admin.uid) {
    if (role !== undefined) {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
    }
    if (disabled !== undefined) {
      return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
    }
  }

  const db = getAdminDb();
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Build update object with only provided fields
  const update: Record<string, any> = {};
  if (role !== undefined) {
    if (role !== 'admin' && role !== 'user') {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    update.role = role;
  }
  if (disabled !== undefined) {
    update.disabled = !!disabled;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  await userRef.update(update);

  return NextResponse.json({ success: true });
}
