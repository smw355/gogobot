import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession, SessionUser } from './verify-session';

export interface ProjectAccessResult {
  user: SessionUser;
  projectId: string;
  project: FirebaseFirestore.DocumentData;
  projectRef: FirebaseFirestore.DocumentReference;
}

/**
 * Verify that the current user is authenticated and owns the given project.
 * Returns the user, project data, and Firestore reference, or null if access denied.
 */
export async function verifyProjectAccess(
  projectId: string
): Promise<ProjectAccessResult | null> {
  const user = await verifySession();
  if (!user) return null;

  // Validate projectId format
  if (!projectId || projectId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return null;
  }

  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(projectId);
  const projectDoc = await projectRef.get();

  if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
    return null;
  }

  return {
    user,
    projectId,
    project: projectDoc.data()!,
    projectRef,
  };
}
