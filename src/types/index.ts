// Gogobot - Self-hosted AI cloud platform types

// User roles
export type UserRole = 'admin' | 'user';

// Project category (selected at creation time)
export type ProjectCategory =
  | 'static-website'
  | 'app-with-database'
  | 'multi-user-app'
  | 'ai-powered-app'
  | 'something-else';

// Project status
export type ProjectStatus = 'active' | 'deploying' | 'deployed' | 'error' | 'deleted';

// GCP project provisioning status
export type GcpProjectStatus = 'provisioning' | 'ready' | 'error' | 'deleted';

// User document in Firestore
export interface User {
  email: string;
  displayName: string;
  role: UserRole;
  gcpFolderId?: string;        // Per-user GCP folder ID (auto-created)
  disabled?: boolean;           // Admin can disable accounts
  createdAt: Date;
  lastLoginAt: Date;
}

// Invite status
export type InviteStatus = 'pending' | 'accepted' | 'expired';

// Invite document in Firestore (/invites/{inviteId})
export interface Invite {
  id: string;
  email: string;
  invitedBy: string;            // Admin uid who created invite
  invitedByEmail: string;
  token: string;                // Secure random token for invite URL
  status: InviteStatus;
  expiresAt: Date;              // 7 days from creation
  createdAt: Date;
  acceptedAt?: Date;
  acceptedByUserId?: string;
}

// Firebase client config (for initializing Firebase SDK in user apps)
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

// GCP project configuration (per Gogobot project)
export interface GcpProjectConfig {
  projectId: string;           // e.g. "gogobot-p-abc123"
  projectNumber?: string;
  hostingSiteId?: string;      // Firebase Hosting site ID
  hostingUrl?: string;         // e.g. "https://gogobot-p-abc123.web.app"
  userFolderId?: string;       // GCP folder ID for this user's projects
  firebaseAppId?: string;      // Firebase Web App ID
  firebaseConfig?: FirebaseClientConfig; // Client-side Firebase config
  region: string;              // e.g. "us-central1"
  status: GcpProjectStatus;
  enabledApis: string[];       // e.g. ["firebasehosting.googleapis.com"]
  billingEnabled?: boolean;    // Whether billing account was successfully linked
  error?: string;              // Error message if status === 'error'
  createdAt: Date;
}

// Project document in Firestore
export interface Project {
  id: string;
  name: string;
  category?: ProjectCategory;
  userId: string;
  status: ProjectStatus;
  gcpProject?: GcpProjectConfig;
  deployment?: {
    url: string;
    deployedAt: Date;
  } | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Instance configuration (stored in /config/instance)
export interface InstanceConfig {
  setupComplete: boolean;
  instanceName: string;
  adminEmail: string;
  gcpProjectId: string;        // Platform GCP project ID
  billingAccountId?: string;   // For creating user project GCP projects
  createdAt: Date;
}

// Message in chat
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  codeGenerated?: boolean;
}

// Tool call from AI
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

// Create project input
export interface CreateProjectInput {
  name: string;
  description?: string;
  category?: ProjectCategory;
}
