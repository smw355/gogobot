import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/verify-session';
import { getAdminDb } from '@/lib/firebase/admin';

export async function GET() {
  try {
    const session = await verifySession();

    if (!session) {
      return NextResponse.json({ user: null });
    }

    // Get user data from Firestore
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(session.uid).get();

    if (!userDoc.exists) {
      return NextResponse.json({ user: null });
    }

    const userData = userDoc.data()!;

    return NextResponse.json({
      user: {
        uid: session.uid,
        email: session.email,
        displayName: userData.displayName,
        role: userData.role,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json({ user: null });
  }
}
