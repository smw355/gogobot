import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAdmin } from '@/lib/auth/verify-admin';
import { getAdminDb } from '@/lib/firebase/admin';

const INVITE_EXPIRY_DAYS = 7;

export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getAdminDb();
  const snapshot = await db.collection('invites').orderBy('createdAt', 'desc').get();

  const invites = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email,
      invitedBy: data.invitedBy,
      invitedByEmail: data.invitedByEmail,
      token: data.token,
      status: data.status,
      expiresAt: data.expiresAt?.toDate?.() || data.expiresAt,
      createdAt: data.createdAt?.toDate?.() || data.createdAt,
      acceptedAt: data.acceptedAt?.toDate?.() || data.acceptedAt || null,
      acceptedByUserId: data.acceptedByUserId || null,
    };
  });

  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { email } = await request.json();

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const db = getAdminDb();

  // Check if user already exists
  const usersSnapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!usersSnapshot.empty) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
  }

  // Check for existing pending invite
  const existingInvite = await db.collection('invites')
    .where('email', '==', normalizedEmail)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (!existingInvite.empty) {
    return NextResponse.json(
      { error: 'A pending invite already exists for this email' },
      { status: 409 }
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString('hex');

  const inviteData = {
    email: normalizedEmail,
    invitedBy: admin.uid,
    invitedByEmail: admin.email,
    token,
    status: 'pending',
    expiresAt,
    createdAt: now,
  };

  const docRef = await db.collection('invites').add(inviteData);

  // Always use NEXT_PUBLIC_BASE_URL for invite links (never trust Origin header)
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || request.headers.get('origin') || '').replace(/\/$/, '');
  const inviteUrl = `${baseUrl}/login?invite=${token}`;

  return NextResponse.json({
    invite: { id: docRef.id, ...inviteData },
    inviteUrl,
  });
}
