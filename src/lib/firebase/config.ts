import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

// Lazy initialization - only initialize when actually used
function initializeFirebase() {
  // Skip initialization during build (server-side without window)
  if (typeof window === 'undefined') return null;

  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    authInstance = getAuth(app);
    dbInstance = getFirestore(app);
  }

  return app;
}

// Lazy getters
export const getAuthInstance = () => {
  if (!authInstance) initializeFirebase();
  if (!authInstance) throw new Error('Firebase Auth not initialized');
  return authInstance;
};

export const getDbInstance = () => {
  if (!dbInstance) initializeFirebase();
  if (!dbInstance) throw new Error('Firebase Firestore not initialized');
  return dbInstance;
};

// Legacy exports for backwards compatibility using Proxy
export const auth = new Proxy({} as Auth, {
  get(target, prop) {
    const instance = getAuthInstance();
    return (instance as any)[prop];
  },
});

export const db = new Proxy({} as Firestore, {
  get(target, prop) {
    const instance = getDbInstance();
    return (instance as any)[prop];
  },
});

export default app;
