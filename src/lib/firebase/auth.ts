'use client';

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getAuthInstance } from './config';

// Sign in with email and password
export async function signIn(email: string, password: string): Promise<User> {
  const auth = getAuthInstance();
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

// Create new user with email and password
export async function signUp(email: string, password: string): Promise<User> {
  const auth = getAuthInstance();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

// Send password reset email
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const auth = getAuthInstance();
  // Use current origin so the reset link points to our /reset-password page
  await firebaseSendPasswordResetEmail(auth, email, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: false,
  });
}

// Sign out
export async function signOut(): Promise<void> {
  const auth = getAuthInstance();

  // Clear session cookie
  await fetch('/api/auth/session-logout', { method: 'POST' });

  await firebaseSignOut(auth);
}

// Get current user
export function getCurrentUser(): User | null {
  const auth = getAuthInstance();
  return auth.currentUser;
}

// Subscribe to auth state changes
export function onAuthChange(callback: (user: User | null) => void): () => void {
  const auth = getAuthInstance();
  return onAuthStateChanged(auth, callback);
}

// Get ID token for API calls
export async function getIdToken(): Promise<string | undefined> {
  const auth = getAuthInstance();
  return auth.currentUser?.getIdToken();
}
