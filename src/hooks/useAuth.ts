'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getAuthInstance, getDbInstance } from '@/lib/firebase/config';
import { signOut as firebaseSignOut } from '@/lib/firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserRole } from '@/types';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(getAuthInstance(), async (authUser) => {
      if (authUser) {
        // Update session cookie for server-side auth
        try {
          const idToken = await authUser.getIdToken();
          await fetch('/api/auth/session-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
        } catch (error) {
          console.error('Failed to create session:', error);
        }

        // Subscribe to Firestore profile for real-time updates
        const db = getDbInstance();
        unsubscribeProfile = onSnapshot(
          doc(db, 'users', authUser.uid),
          (profileDoc) => {
            const profileData = profileDoc.data();

            // Force logout disabled users immediately
            if (profileData?.disabled === true) {
              firebaseSignOut();
              setUser(null);
              setLoading(false);
              return;
            }

            setUser({
              uid: authUser.uid,
              email: authUser.email,
              displayName: profileData?.displayName || authUser.displayName,
              role: profileData?.role || 'user',
            });
            setLoading(false);
          },
          (error) => {
            console.error('Error fetching profile:', error);
            // Fallback to auth user data if profile fetch fails
            setUser({
              uid: authUser.uid,
              email: authUser.email,
              displayName: authUser.displayName,
              role: 'user',
            });
            setLoading(false);
          }
        );
      } else {
        // User signed out
        try {
          await fetch('/api/auth/session-logout', { method: 'POST' });
        } catch (error) {
          console.error('Failed to clear session:', error);
        }
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  return { user, loading };
}
