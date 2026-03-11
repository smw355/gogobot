import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

const INVITE_EXPIRY_DAYS = 7;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { inviteId } = await params;
  const db = getAdminDb();
  const inviteRef = db.collection('invites').doc(inviteId);
  const inviteDoc = await inviteRef.get();

  if (!inviteDoc.exists) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  await inviteRef.delete();
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { inviteId } = await params;
  const db = getAdminDb();
  const inviteRef = db.collection('invites').doc(inviteId);
  const inviteDoc = await inviteRef.get();

  if (!inviteDoc.exists) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  const data = inviteDoc.data()!;

  if (data.status === 'accepted') {
    return NextResponse.json({ error: 'Cannot resend an accepted invite' }, { status: 400 });
  }

  // Reset expiry and status
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await inviteRef.update({
    status: 'pending',
    expiresAt,
  });

  // Derive base URL from the request origin (NEXT_PUBLIC_BASE_URL may be empty in production)
  const origin = request.headers.get('origin') || request.headers.get('referer')?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_BASE_URL || '';
  const baseUrl = origin.replace(/\/$/, '');
  const inviteUrl = `${baseUrl}/login?invite=${data.token}`;

  return NextResponse.json({ success: true, inviteUrl });
}
