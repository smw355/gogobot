import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

let app: App | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

function initializeAdmin() {
  // Skip if running on client
  if (typeof window !== 'undefined') return;

  // Already initialized
  if (app) return;

  // Check for required env var
  if (!process.env.FIREBASE_ADMIN_KEY) {
    console.warn('FIREBASE_ADMIN_KEY not set - Firebase Admin SDK not initialized');
    return;
  }

  try {
    if (!getApps().length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
      app = initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      });
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

export const getAdminDb = () => {
  if (!db) initializeAdmin();
  if (!db) throw new Error('Firebase Admin Firestore not initialized');
  return db;
};

export const getAdminAuth = () => {
  if (!auth) initializeAdmin();
  if (!auth) throw new Error('Firebase Admin Auth not initialized');
  return auth;
};

export const getAdminApp = () => {
  if (!app) initializeAdmin();
  return app;
};
