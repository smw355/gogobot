'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { PreviewPane } from './PreviewPane';
import { Project } from '@/types';
import { cn } from '@/lib/utils/cn';
import { Spinner } from '@/components/ui';
import { Sparkles, AlertCircle, Check } from 'lucide-react';
import { WebContainerManager } from '@/lib/webcontainer/manager';
import { ApiClient } from '@/lib/ai/api-client';
import { getAuth } from 'firebase/auth';

export type WorkspaceStep = 'loading' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';

export interface WorkspaceStatus {
  step: WorkspaceStep;
  error?: string;
}

interface ChatInterfaceProps {
  project: Project;
  className?: string;
  onDeployRequest?: () => void;
  onWorkspaceStatusChange?: (status: WorkspaceStatus) => void;
  deployRef?: React.MutableRefObject<{
    deploy: () => Promise<{ success: boolean; url?: string; error?: string }>;
    isDeploying: boolean;
    deploymentUrl: string | null;
    workspaceStatus: WorkspaceStatus;
  } | null>;
}

// Convert flat file map to WebContainer FileSystemTree format
function filesToFileSystemTree(files: Record<string, string>): Record<string, any> {
  const tree: Record<string, any> = {};

  Object.entries(files).forEach(([path, content]) => {
    const parts = path.split('/');
    let current = tree;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        current[part] = { file: { contents: content } };
      } else {
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        current = current[part].directory;
      }
    });
  });

  return tree;
}

const STEP_ORDER: WorkspaceStep[] = ['loading', 'booting', 'installing', 'starting', 'ready'];

function WorkspaceStepItem({ step, label, currentStep }: { step: WorkspaceStep; label: string; currentStep: WorkspaceStep }) {
  const stepIndex = STEP_ORDER.indexOf(step);
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const isComplete = currentIndex > stepIndex;
  const isActive = currentStep === step;

  return (
    <div className="flex items-center gap-2.5">
      {isComplete ? (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
          <Check className="h-3 w-3 text-white" />
        </div>
      ) : isActive ? (
        <div className="flex h-5 w-5 items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : (
        <div className="h-5 w-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
      )}
      <span className={cn(
        'text-sm',
        isComplete ? 'text-green-600 dark:text-green-400' :
        isActive ? 'text-zinc-900 dark:text-zinc-100 font-medium' :
        'text-zinc-400 dark:text-zinc-500'
      )}>
        {label}
      </span>
    </div>
  );
}

export function ChatInterface({ project, className, deployRef, onWorkspaceStatusChange }: ChatInterfaceProps) {
  const [containerManager, setContainerManager] = useState<WebContainerManager | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [workspaceStep, setWorkspaceStep] = useState<WorkspaceStep>('loading');
  const [containerError, setContainerError] = useState<string | null>(null);
  const [savedFiles, setSavedFiles] = useState<Record<string, string>>({});
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);

  // Resizable split pane
  const [splitPercent, setSplitPercent] = useState(50);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const apiClientRef = useRef(new ApiClient());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedFilesRef = useRef<Record<string, string>>({});
  const lastSavedSnapshotRef = useRef<string>(''); // JSON string of last saved files for dirty check
  const authTokenRef = useRef<string | null>(null); // Cache auth token for sync save on unload
  const filesRef = useRef<Record<string, string>>({}); // Latest files for use in event handlers
  const prevIsLoadingRef = useRef(false);

  const {
    messages,
    currentMessage,
    setCurrentMessage,
    isLoading,
    error,
    files,
    recentlyChangedFiles,
    sendMessage,
    stopGeneration,
    isDeploying,
    deploymentUrl,
    deployProject,
  } = useChat(project.id, containerManager, savedFiles);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Notify parent of workspace status changes
  useEffect(() => {
    onWorkspaceStatusChange?.({
      step: workspaceStep,
      error: containerError || undefined,
    });
  }, [workspaceStep, containerError, onWorkspaceStatusChange]);

  // Expose deployment functionality and workspace status via ref
  useEffect(() => {
    if (deployRef) {
      deployRef.current = {
        deploy: deployProject,
        isDeploying,
        deploymentUrl,
        workspaceStatus: {
          step: workspaceStep,
          error: containerError || undefined,
        },
      };
    }
  }, [deployRef, deployProject, isDeploying, deploymentUrl, workspaceStep, containerError]);

  // Load saved files on mount
  useEffect(() => {
    const loadSavedFiles = async () => {
      try {
        const auth = getAuth();
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          setIsLoadingFiles(false);
          return;
        }

        // Cache token for unload handler
        authTokenRef.current = idToken;

        const loadedFiles = await apiClientRef.current.loadSnapshot(project.id, idToken);
        if (loadedFiles) {
          savedFilesRef.current = loadedFiles;
          setSavedFiles(loadedFiles);
          lastSavedSnapshotRef.current = JSON.stringify(loadedFiles);
        }
      } catch (err) {
        console.error('Failed to load saved files:', err);
      } finally {
        setIsLoadingFiles(false);
      }
    };

    loadSavedFiles();
  }, [project.id]);

  // Keep filesRef in sync for use in synchronous event handlers (beforeunload)
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Save files and track what was saved (for dirty checking)
  const saveFiles = useCallback(async (filesToSave: Record<string, string>) => {
    try {
      if (Object.keys(filesToSave).length === 0) return;

      // Skip if nothing changed since last save
      const currentSnapshot = JSON.stringify(filesToSave);
      if (currentSnapshot === lastSavedSnapshotRef.current) return;

      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      // Cache token for synchronous save on unload
      authTokenRef.current = idToken;

      await apiClientRef.current.saveSnapshot(project.id, filesToSave, idToken);
      lastSavedSnapshotRef.current = currentSnapshot;
      console.log(`Snapshot saved (${Object.keys(filesToSave).length} files)`);
    } catch (err) {
      console.error('Failed to save files:', err);
    }
  }, [project.id]);

  // Auto-save files when they change (debounced 2 seconds)
  useEffect(() => {
    if (Object.keys(files).length === 0) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveFiles(files);
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [files, saveFiles]);

  // Immediate save when AI finishes generating (isLoading transitions true → false)
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && Object.keys(files).length > 0) {
      // AI just finished — save immediately, cancel any pending debounce
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      saveFiles(files);
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, files, saveFiles]);

  // Save on page unload and tab switch to prevent data loss
  useEffect(() => {
    const saveOnUnload = () => {
      const currentFiles = filesRef.current;
      if (Object.keys(currentFiles).length === 0) return;

      // Skip if nothing changed since last save
      const currentSnapshot = JSON.stringify(currentFiles);
      if (currentSnapshot === lastSavedSnapshotRef.current) return;

      // Use fetch with keepalive for best chance of completing during unload
      const token = authTokenRef.current;
      if (!token) return;

      try {
        fetch(`/api/projects/${project.id}/snapshot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ files: currentFiles }),
          keepalive: true,
        });
      } catch {
        // Best-effort — nothing else we can do during unload
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveOnUnload();
      }
    };

    window.addEventListener('beforeunload', saveOnUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', saveOnUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [project.id]);

  // Track which project we've initialized to avoid redundant re-inits
  const initializedProjectRef = useRef<string | null>(null);

  // Initialize WebContainer after files are loaded
  useEffect(() => {
    if (isLoadingFiles) return;

    // Skip re-init if we already initialized for this project
    if (initializedProjectRef.current === project.id) {
      // Dev server may already be running from a previous mount — check for URL
      const manager = new WebContainerManager();
      const existingUrl = manager.getPreviewUrl();
      if (existingUrl) {
        setPreviewUrl(existingUrl);
        setContainerManager(manager);
        setWorkspaceStep('ready');
      }
      return;
    }

    const initContainer = async () => {
      try {
        console.log('Initializing WebContainer...');
        setWorkspaceStep('booting');

        const manager = new WebContainerManager();

        // Check if the dev server is already running (e.g. survived a re-mount)
        const existingUrl = manager.getPreviewUrl();
        if (existingUrl) {
          console.log('WebContainer already running, reusing existing dev server');
          setPreviewUrl(existingUrl);
          setContainerManager(manager);
          setWorkspaceStep('ready');
          initializedProjectRef.current = project.id;
          return;
        }

        // Ensure essential files always exist (may be missing from old snapshots or new projects)
        const filesToMount = { ...savedFilesRef.current };
        if (!filesToMount['package.json']) {
          filesToMount['package.json'] = JSON.stringify(
            {
              name: 'project',
              type: 'module',
              dependencies: {},
              devDependencies: { vite: '^5.0.0' },
              scripts: { dev: 'vite', build: 'vite build' },
            },
            null,
            2
          );
        }
        if (!filesToMount['index.html']) {
          filesToMount['index.html'] = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gogobot Project</title>
  </head>
  <body>
    <div id="root">
      <h1>Welcome to Gogobot!</h1>
      <p>Start chatting to build your app.</p>
    </div>
  </body>
</html>`;
        }

        const initialFiles = filesToFileSystemTree(filesToMount);
        await manager.initialize(project.id, initialFiles);

        for (const [path, content] of Object.entries(filesToMount)) {
          try {
            await manager.writeFile(path, content);
          } catch (err) {
            console.error(`Failed to write saved file ${path}:`, err);
          }
        }

        // Track default files in state so they get saved to snapshot on next auto-save
        if (Object.keys(filesToMount).length !== Object.keys(savedFilesRef.current).length) {
          savedFilesRef.current = filesToMount;
          setSavedFiles(filesToMount);
        }

        setWorkspaceStep('installing');
        await manager.installDependencies();

        setWorkspaceStep('starting');
        await manager.startDevServer();

        setContainerManager(manager);
        setWorkspaceStep('ready');
        initializedProjectRef.current = project.id;

        // Check if the preview URL was already captured during startDevServer()
        const immediateUrl = manager.getPreviewUrl();
        if (immediateUrl) {
          setPreviewUrl(immediateUrl);
        } else {
          // Poll for it — the server-ready event may fire shortly after
          const checkPreview = setInterval(() => {
            const url = manager.getPreviewUrl();
            if (url) {
              setPreviewUrl(url);
              clearInterval(checkPreview);
            }
          }, 500);

          setTimeout(() => clearInterval(checkPreview), 30000);
        }

        console.log('WebContainer ready!');
      } catch (err: any) {
        console.error('Failed to initialize WebContainer:', err);
        setContainerError(err.message || 'Failed to initialize workspace');
        setWorkspaceStep('error');
      }
    };

    initContainer();

    return () => {
      WebContainerManager.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, isLoadingFiles]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Resizable split pane drag handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(80, Math.max(20, percent)));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleSubmit = () => {
    if (!currentMessage.trim()) return;

    if (workspaceStep !== 'ready') {
      console.warn('Container not ready yet');
      return;
    }

    sendMessage(currentMessage);
  };

  const handleAssetsUploaded = (assets: { name: string; url: string }[]) => {
    const assetList = assets.map(a => `${a.name}: ${a.url}`).join('\n');
    const msg = `I've uploaded ${assets.length === 1 ? 'a file' : `${assets.length} files`}. Please use ${assets.length === 1 ? 'it' : 'them'} in the app:\n${assetList}`;
    sendMessage(msg);
  };

  const isContainerReady = workspaceStep === 'ready';
  const hasMessages = messages.length > 0;

  return (
    <div ref={containerRef} className={cn('flex h-full', className)}>
      {/* Chat panel */}
      <div className="flex flex-col" style={{ width: `${splitPercent}%` }}>
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {/* Empty state */}
          {!hasMessages && isContainerReady && (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                What would you like to build?
              </h3>
              <p className="mt-2 max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
                Describe your idea and I'll help you create it step by step.
              </p>
              <div className="mt-6 space-y-2 text-sm text-zinc-500 dark:text-zinc-400">
                <p>Try something like:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>"Create a landing page for my bakery"</li>
                  <li>"Build a simple todo app"</li>
                  <li>"Make a contact form that emails me"</li>
                </ul>
              </div>
            </div>
          )}

          {/* Initializing state */}
          {!hasMessages && !isContainerReady && workspaceStep !== 'error' && (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
                <Spinner size="lg" className="border-white" />
              </div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                Setting up your workspace
              </h3>
              <div className="mt-4 w-64 space-y-2">
                <WorkspaceStepItem step="loading" label="Loading project files" currentStep={workspaceStep} />
                <WorkspaceStepItem step="booting" label="Starting workspace" currentStep={workspaceStep} />
                <WorkspaceStepItem step="installing" label="Installing dependencies" currentStep={workspaceStep} />
                <WorkspaceStepItem step="starting" label="Starting dev server" currentStep={workspaceStep} />
              </div>
            </div>
          )}

          {/* Error state */}
          {workspaceStep === 'error' && (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                Workspace Setup Failed
              </h3>
              <p className="mt-2 max-w-sm text-center text-sm text-red-600 dark:text-red-400">
                {containerError || 'Failed to initialize workspace'}
              </p>
              <p className="mt-1 max-w-sm text-center text-xs text-zinc-500 dark:text-zinc-400">
                This could be a temporary issue. Try reloading the page.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Reload page
              </button>
            </div>
          )}

          {/* Messages */}
          {hasMessages && (
            <div>
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLastMessage={index === messages.length - 1}
                  isGenerating={isLoading}
                />
              ))}

              {isLoading && (
                <div className="flex items-center gap-3 px-4 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600">
                    <Spinner size="sm" className="border-white" />
                  </div>
                  <span className="text-sm text-zinc-500">Thinking...</span>
                </div>
              )}

              {error && (
                <div className="mx-4 my-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-red-800 dark:text-red-300">
                        Something went wrong
                      </p>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400 break-words">
                        {error}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <ChatInput
          value={currentMessage}
          onChange={setCurrentMessage}
          onSubmit={handleSubmit}
          onStop={stopGeneration}
          isLoading={isLoading || !isContainerReady}
          placeholder={
            isContainerReady
              ? "Describe what you want to build..."
              : "Setting up workspace..."
          }
          disabled={!isContainerReady}
          projectId={project.id}
          onAssetsUploaded={handleAssetsUploaded}
        />
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={handleDividerMouseDown}
        className="relative z-10 w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-blue-400 active:bg-blue-500 transition-colors dark:bg-zinc-800 dark:hover:bg-blue-600 dark:active:bg-blue-500"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" /> {/* Wider hit area */}
      </div>

      {/* Preview panel */}
      <PreviewPane
        files={files}
        recentlyChangedFiles={recentlyChangedFiles}
        deploymentUrl={project.deployment?.url}
        previewUrl={previewUrl}
        isLoading={workspaceStep !== 'ready' && workspaceStep !== 'error'}
        style={{ width: `${100 - splitPercent}%` }}
      />
    </div>
  );
}
