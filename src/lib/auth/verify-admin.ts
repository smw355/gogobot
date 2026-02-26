import { verifySession, SessionUser } from './verify-session';
import { getAdminDb } from '@/lib/firebase/admin';

/**
 * Verify that the current session belongs to an admin user.
 * Returns the session user if admin, null otherwise.
 */
export async function verifyAdmin(): Promise<SessionUser | null> {
  const user = await verifySession();
  if (!user) return null;

  const db = getAdminDb();
  const userDoc = await db.collection('users').doc(user.uid).get();

  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
    return null;
  }

  return user;
}
