import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ valid: false, error: 'Token required' });
    }

    const db = getAdminDb();
    const snapshot = await db.collection('invites')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ valid: false, error: 'Invalid invite link' });
    }

    const invite = snapshot.docs[0].data();

    if (invite.status === 'accepted') {
      return NextResponse.json({ valid: false, error: 'This invite has already been used' });
    }

    const expiresAt = invite.expiresAt?.toDate?.() || new Date(invite.expiresAt);
    if (expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ valid: false, expired: true, error: 'This invite has expired. Contact your admin for a new one.' });
    }

    return NextResponse.json({
      valid: true,
      email: invite.email,
    });
  } catch (error) {
    console.error('Validate invite error:', error);
    return NextResponse.json({ valid: false, error: 'Failed to validate invite' });
  }
}
