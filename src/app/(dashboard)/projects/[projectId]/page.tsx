'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getDbInstance } from '@/lib/firebase/config';
import { useAuth } from '@/hooks/useAuth';
import { ChatInterface } from '@/components/chat';
import type { WorkspaceStatus } from '@/components/chat/ChatInterface';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { Project } from '@/types';
import { ArrowLeft, Rocket, ExternalLink, Cloud, AlertCircle, Loader2, Trash2, Lock } from 'lucide-react';
import { SecretsPanel } from '@/components/secrets/SecretsPanel';
import Link from 'next/link';

const WORKSPACE_STEP_LABELS: Record<string, string> = {
  loading: 'Loading project...',
  booting: 'Starting workspace...',
  installing: 'Installing dependencies...',
  starting: 'Starting dev server...',
};

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const deployRef = useRef<{
    deploy: () => Promise<{ success: boolean; url?: string; error?: string }>;
    isDeploying: boolean;
    deploymentUrl: string | null;
    workspaceStatus: WorkspaceStatus;
  } | null>(null);

  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({ step: 'loading' });

  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const projectId = params.projectId as string;

  useEffect(() => {
    if (!user || !projectId) return;

    const db = getDbInstance();
    const unsubscribe = onSnapshot(
      doc(db, 'projects', projectId),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setProject({
            id: docSnapshot.id,
            ...data,
            createdAt: data.createdAt?.toDate(),
            updatedAt: data.updatedAt?.toDate(),
          } as Project);

          if (data.deployment?.url) {
            setDeploymentUrl(data.deployment.url);
          }

          // Redirect if project was deleted (e.g. by another tab)
          if (data.status === 'deleted') {
            router.push('/projects');
            return;
          }
        } else {
          router.push('/projects');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching project:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, projectId, router]);

  // Auto-retry provisioning when status is 'error'
  const retryTriggered = useRef(false);
  useEffect(() => {
    if (!project || !projectId || retryTriggered.current) return;
    if (project.gcpProject?.status !== 'error') return;

    retryTriggered.current = true;
    console.log('Auto-retrying GCP provisioning...');

    (async () => {
      try {
        const auth = getAuth();
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;

        await fetch(`/api/projects/${projectId}/tools`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ tool: 'getProjectInfo', args: {} }),
        });
      } catch (err) {
        console.error('Failed to trigger provisioning retry:', err);
      }
    })();
  }, [project, projectId]);

  const handleDeploy = async () => {
    if (!deployRef.current) return;

    setIsDeploying(true);
    setDeployError(null);
    const result = await deployRef.current.deploy();
    setIsDeploying(false);

    if (result.success && result.url) {
      setDeploymentUrl(result.url);
    } else if (result.error) {
      setDeployError(result.error);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete project');
      }

      router.push('/projects');
    } catch (err: any) {
      console.error('Failed to delete project:', err);
      setDeployError(err.message || 'Failed to delete project');
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-500">Project not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {project.name}
          </h1>
          {project.gcpProject?.status === 'provisioning' && (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Setting up cloud (~1 min)
            </span>
          )}
          {project.gcpProject?.status === 'ready' && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Cloud className="h-3 w-3" />
              Cloud ready
            </span>
          )}
          {project.gcpProject?.status === 'error' && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <AlertCircle className="h-3 w-3" />
              Cloud setup failed — retrying
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {deploymentUrl && (
            <a
              href={deploymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              View Live
            </a>
          )}
          <Button
            onClick={handleDeploy}
            isLoading={isDeploying}
            disabled={isDeploying || workspaceStatus.step !== 'ready'}
          >
            <Rocket className="h-4 w-4" />
            Deploy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSecrets(true)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            title="Manage secrets"
          >
            <Lock className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Delete {project.name}?
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This will shut down the cloud resources for this project.
              An admin can recover it within 30 days.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                isLoading={isDeleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Delete Project
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Secrets modal */}
      {showSecrets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <SecretsPanel
              projectId={projectId}
              onClose={() => setShowSecrets(false)}
            />
          </div>
        </div>
      )}

      {/* Deploy error banner */}
      {deployError && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="flex-1 text-sm text-red-800 dark:text-red-300">{deployError}</p>
          <button
            onClick={() => setDeployError(null)}
            className="text-xs text-red-600 hover:text-red-800 dark:text-red-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace loading banner */}
      {workspaceStatus.step !== 'ready' && workspaceStatus.step !== 'error' && (
        <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500 dark:text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {WORKSPACE_STEP_LABELS[workspaceStatus.step] || 'Loading workspace...'}
          </p>
        </div>
      )}

      {/* Provisioning banner */}
      {project.gcpProject?.status === 'provisioning' && (
        <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-900/20">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Setting up your cloud environment (GCP project, Firebase Hosting, APIs). This usually takes about a minute.
            You can start chatting while it finishes.
          </p>
        </div>
      )}

      {/* Chat Interface */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface project={project} deployRef={deployRef} onWorkspaceStatusChange={setWorkspaceStatus} />
      </div>
    </div>
  );
}
