import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const { idToken, inviteToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: 'ID token required' }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // Create session cookie (14 days max for Firebase)
    const expiresIn = 60 * 60 * 24 * 14 * 1000; // 14 days
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    // Create/update user document in Firestore
    const adminDb = getAdminDb();
    const userRef = adminDb.collection('users').doc(decodedToken.uid);
    const userDoc = await userRef.get();

    const now = new Date();

    if (!userDoc.exists) {
      // Check if this is the first user (make them admin)
      const usersSnapshot = await adminDb.collection('users').limit(1).get();
      const isFirstUser = usersSnapshot.empty;

      // Non-first users require a valid invite
      if (!isFirstUser) {
        if (!inviteToken) {
          return NextResponse.json(
            { error: 'An invite is required to create an account' },
            { status: 403 }
          );
        }

        // Validate invite token
        const inviteSnapshot = await adminDb.collection('invites')
          .where('token', '==', inviteToken)
          .where('status', '==', 'pending')
          .limit(1)
          .get();

        if (inviteSnapshot.empty) {
          return NextResponse.json(
            { error: 'Invalid or expired invite' },
            { status: 403 }
          );
        }

        const inviteDoc = inviteSnapshot.docs[0];
        const inviteData = inviteDoc.data();
        const expiresAt = inviteData.expiresAt?.toDate?.() || new Date(inviteData.expiresAt);

        if (expiresAt.getTime() < Date.now()) {
          return NextResponse.json(
            { error: 'This invite has expired. Contact your admin for a new one.' },
            { status: 403 }
          );
        }

        // Mark invite as accepted
        await inviteDoc.ref.update({
          status: 'accepted',
          acceptedAt: now,
          acceptedByUserId: decodedToken.uid,
        });
      }

      // New user - create document
      const displayName = decodedToken.name || decodedToken.email?.split('@')[0] || 'User';

      await userRef.set({
        email: decodedToken.email || '',
        displayName,
        role: isFirstUser ? 'admin' : 'user', // First user becomes admin
        createdAt: now,
        lastLoginAt: now,
      });

      // If first user, mark setup as started
      if (isFirstUser) {
        const configRef = adminDb.collection('config').doc('instance');
        await configRef.set({
          setupComplete: false,
          adminEmail: decodedToken.email || '',
          createdAt: now,
        }, { merge: true });
      }
    } else {
      // Existing user — check if disabled
      const userData = userDoc.data();
      if (userData?.disabled) {
        return NextResponse.json(
          { error: 'Your account has been disabled. Contact your admin.' },
          { status: 403 }
        );
      }

      // Existing user - update last login
      await userRef.update({
        lastLoginAt: now,
      });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('session', sessionCookie, {
      maxAge: expiresIn / 1000, // Convert to seconds
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return response;
  } catch (error) {
    logger.error('Session login error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
