import { cookies } from 'next/headers';
import { getAdminAuth } from '@/lib/firebase/admin';

export interface SessionUser {
  uid: string;
  email: string;
}

export async function verifySession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get('session')?.value;

    if (!session) {
      return null;
    }

    const adminAuth = getAdminAuth();
    const decodedClaims = await adminAuth.verifySessionCookie(session, true);

    return {
      uid: decodedClaims.uid,
      email: decodedClaims.email || '',
    };
  } catch (error) {
    console.error('Session verification failed:', error);
    return null;
  }
}
