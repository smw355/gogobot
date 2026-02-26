'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, ToolCall } from '@/lib/ai/types';
import { ApiClient } from '@/lib/ai/api-client';
import { ToolExecutor } from '@/lib/ai/tool-executor';
import { WebContainerManager } from '@/lib/webcontainer/manager';
import { getAuth } from 'firebase/auth';

const MAX_TOOL_ITERATIONS = 40;
const MAX_CONSECUTIVE_FAILURES = 5;
const RATE_LIMIT_DELAY_MS = 3000;
const MAX_TOOL_RESULT_LENGTH = 4000;

/** Truncate large tool results to avoid blowing up the chat history payload */
function truncateResult(result: any): any {
  if (!result) return result;
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str.length <= MAX_TOOL_RESULT_LENGTH) return result;
  // For objects, truncate stringified version and parse back
  if (typeof result === 'object') {
    // Truncate large string fields within the object
    const truncated: any = {};
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'string' && val.length > MAX_TOOL_RESULT_LENGTH) {
        truncated[key] = val.slice(0, MAX_TOOL_RESULT_LENGTH) + '\n... (truncated)';
      } else {
        truncated[key] = val;
      }
    }
    return truncated;
  }
  return str.slice(0, MAX_TOOL_RESULT_LENGTH) + '\n... (truncated)';
}

export function useChat(
  projectId: string,
  containerManager: WebContainerManager | null,
  initialFiles: Record<string, string> = {}
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>(initialFiles);
  const [recentlyChangedFiles, setRecentlyChangedFiles] = useState<Set<string>>(new Set());
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);

  const apiClientRef = useRef<ApiClient>(new ApiClient());
  const changeTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const toolExecutorRef = useRef<ToolExecutor | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const shouldStopRef = useRef(false);
  const filesRef = useRef<Record<string, string>>(initialFiles);
  const savedMessageIdsRef = useRef<Set<string>>(new Set());

  // Keep filesRef in sync with files state
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Load messages from Firestore on mount
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const auth = getAuth();
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          setIsLoadingMessages(false);
          return;
        }

        const response = await fetch(`/api/projects/${projectId}/messages`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.messages && data.messages.length > 0) {
            // Mark loaded messages as already saved
            data.messages.forEach((msg: Message) => savedMessageIdsRef.current.add(msg.id));
            setMessages(data.messages);
          }
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();
  }, [projectId]);

  // Save a message to Firestore (debounced, only save final state)
  const saveMessage = useCallback(async (message: Message) => {
    // Skip if already saved
    if (savedMessageIdsRef.current.has(message.id)) return;

    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;

      await fetch(`/api/projects/${projectId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ message }),
      });

      savedMessageIdsRef.current.add(message.id);
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  }, [projectId]);

  // Helper to mark a file as recently changed (indicator clears after 3 seconds)
  const markFileChanged = useCallback((path: string) => {
    // Clear any existing timeout for this file
    const existingTimeout = changeTimeoutsRef.current.get(path);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Add to recently changed set
    setRecentlyChangedFiles(prev => new Set(prev).add(path));

    // Set timeout to remove the indicator
    const timeout = setTimeout(() => {
      setRecentlyChangedFiles(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      changeTimeoutsRef.current.delete(path);
    }, 3000);

    changeTimeoutsRef.current.set(path, timeout);
  }, []);

  // Initialize tool executor when container is ready
  useEffect(() => {
    if (containerManager) {
      const executor = new ToolExecutor(containerManager);

      // Configure deployment options
      executor.setOptions({
        projectId,
        getIdToken: async () => {
          const auth = getAuth();
          return auth.currentUser?.getIdToken();
        },
        getFiles: () => filesRef.current,
        onDeployStart: () => setIsDeploying(true),
        onDeployComplete: (result) => {
          setIsDeploying(false);
          if (result.success && result.url) {
            setDeploymentUrl(result.url);
          }
        },
      });

      toolExecutorRef.current = executor;
    }
  }, [containerManager, projectId]);

  // Sync files state when initialFiles changes (for loaded snapshots)
  useEffect(() => {
    if (Object.keys(initialFiles).length > 0) {
      setFiles(prev => {
        // Merge initial files with any files already in state
        return { ...initialFiles, ...prev };
      });
    }
  }, [initialFiles]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      if (!containerManager || !toolExecutorRef.current) {
        setError('WebContainer is not initialized. Please wait...');
        return;
      }

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        codeGenerated: false,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setCurrentMessage('');
      setIsLoading(true);
      setError(null);
      setErrorRetryable(false);
      shouldStopRef.current = false;

      // Save user message to Firestore
      saveMessage(userMessage);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        // Get Firebase ID token
        const auth = getAuth();
        const idToken = await auth.currentUser?.getIdToken();

        if (!idToken) {
          throw new Error('Authentication required. Please sign in.');
        }

        // Build chat history for Gemini
        let chatHistory: any[] = [];
        for (const msg of messages) {
          if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
            // Assistant message with tool calls
            chatHistory.push({
              role: 'assistant',
              content: msg.content || '',
              toolCalls: msg.toolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
            });
            // Tool results as separate user message
            chatHistory.push({
              role: 'user',
              toolResults: msg.toolCalls.map(tc => ({ name: tc.name, result: tc.result || { success: true } })),
            });
          } else {
            chatHistory.push({
              role: msg.role,
              content: msg.content,
            });
          }
        }

        // Add the new user message to history for the first iteration
        chatHistory.push({ role: 'user', content: content.trim() });

        // Agentic loop - continue until no more tool calls
        let iteration = 0;
        let continueLoop = true;
        let consecutiveFailures = 0;
        let lastWasRateLimited = false;

        while (continueLoop && iteration < MAX_TOOL_ITERATIONS && !shouldStopRef.current) {
          // Back off if the last iteration hit a rate limit
          if (lastWasRateLimited) {
            await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
            lastWasRateLimited = false;
          }
          iteration++;

          const assistantMessageId = `assistant-${Date.now()}-${iteration}`;
          let assistantContent = '';
          const toolCalls: ToolCall[] = [];

          // Create assistant message placeholder
          const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            codeGenerated: false,
            timestamp: new Date(),
            toolCalls: [],
          };

          setMessages((prev) => [...prev, assistantMessage]);

          // First iteration: send user message + history (minus the last user msg which server adds)
          // Subsequent iterations: send empty message (tool results already in history)
          const messageToSend = iteration === 1 ? content : '';
          const historyToSend = iteration === 1 ? chatHistory.slice(0, -1) : chatHistory;

          // Pass current file paths so the system prompt knows what exists
          const currentFilePaths = iteration === 1 ? Object.keys(filesRef.current) : undefined;

          await apiClientRef.current.streamChat(
            messageToSend,
            historyToSend,
            projectId,
            idToken,
            async (event) => {
              if (shouldStopRef.current) return;

              switch (event.type) {
                case 'chunk':
                  if (event.content) {
                    assistantContent += event.content;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: assistantContent }
                          : msg
                      )
                    );
                  }
                  break;

                case 'tool_call':
                  if (event.name && event.args && toolExecutorRef.current) {
                    const toolCall: ToolCall = {
                      id: event.toolUseId || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                      name: event.name,
                      args: event.args,
                    };

                    toolCalls.push(toolCall);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, toolCalls: [...toolCalls], codeGenerated: true }
                          : msg
                      )
                    );

                    // Execute tool in WebContainer
                    try {
                      const result = await toolExecutorRef.current.execute(toolCall);
                      toolCall.result = result;

                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, toolCalls: [...toolCalls] }
                            : msg
                        )
                      );

                      // Track file changes for the code panel
                      if (toolCall.name === 'writeFile' && toolCall.args.path && toolCall.args.content) {
                        setFiles((prev) => ({
                          ...prev,
                          [toolCall.args.path]: toolCall.args.content,
                        }));
                        markFileChanged(toolCall.args.path);
                      } else if (toolCall.name === 'patchFile' && toolCall.args.path) {
                        // Re-read file to get updated content after patch
                        try {
                          const updatedContent = await containerManager!.readFile(toolCall.args.path);
                          setFiles((prev) => ({
                            ...prev,
                            [toolCall.args.path]: updatedContent,
                          }));
                          markFileChanged(toolCall.args.path);
                        } catch {
                          // File read failed after patch - skip tracking
                        }
                      } else if (toolCall.name === 'deleteFile' && toolCall.args.path) {
                        setFiles((prev) => {
                          const newFiles = { ...prev };
                          delete newFiles[toolCall.args.path];
                          return newFiles;
                        });
                        markFileChanged(toolCall.args.path);
                      } else if (
                        (toolCall.name === 'installPackage' || toolCall.name === 'runCommand') &&
                        result?.success
                      ) {
                        // npm install / runCommand can modify package.json — re-read it
                        // so the snapshot captures the updated dependencies
                        try {
                          const updatedPkg = await containerManager!.readFile('package.json');
                          setFiles((prev) => ({
                            ...prev,
                            'package.json': updatedPkg,
                          }));
                        } catch {
                          // package.json might not exist yet — skip
                        }
                      }

                      // Track consecutive failures for error recovery
                      // Only count failures where ALL tools in an iteration fail
                      if (result?.success === false) {
                        consecutiveFailures++;
                      } else {
                        // Any success resets the counter
                        consecutiveFailures = 0;
                      }
                    } catch (toolError: any) {
                      consecutiveFailures++;
                      toolCall.result = {
                        success: false,
                        error: toolError.message,
                      };

                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, toolCalls: [...toolCalls] }
                            : msg
                        )
                      );
                    }
                  }
                  break;

                case 'error':
                  setError(event.error || 'An error occurred');
                  setErrorRetryable(event.retryable || false);
                  if (event.retryable) {
                    lastWasRateLimited = true;
                  }
                  break;
              }
            },
            currentFilePaths
          );

          if (shouldStopRef.current) break;

          // Check for too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setError(
              'Several steps failed in a row. The workspace may need a refresh. Check the preview to see the current state, then try describing what needs to be fixed.'
            );
            break;
          }

          // Reset failure counter at iteration boundaries if there were any successes
          // (failures only matter when they're truly consecutive across iterations)


          // Save the completed assistant message to Firestore
          const completedAssistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: assistantContent,
            codeGenerated: toolCalls.length > 0,
            timestamp: new Date(),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
          saveMessage(completedAssistantMessage);

          // Decide whether to continue the loop
          if (toolCalls.length === 0) {
            continueLoop = false;
          } else {
            // Build Gemini-format history entries for the next iteration

            // Assistant turn with tool calls
            chatHistory.push({
              role: 'assistant',
              content: assistantContent,
              toolCalls: toolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
            });

            // User turn with tool results (truncated to keep payload manageable)
            chatHistory.push({
              role: 'user',
              toolResults: toolCalls.map(tc => ({ name: tc.name, result: truncateResult(tc.result) })),
            });
          }
        }

        if (iteration >= MAX_TOOL_ITERATIONS) {
          setError('This task required many steps. Check if your app is working in the preview - it might be complete! If not, try asking me to continue or break the task into smaller parts.');
        }

        setIsLoading(false);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to send message');
        }
        setIsLoading(false);
      }
    },
    [messages, isLoading, projectId, containerManager, saveMessage, markFileChanged]
  );

  const stopGeneration = useCallback(() => {
    shouldStopRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const clearChat = useCallback(async () => {
    setMessages([]);
    setFiles({});
    setError(null);
    setCurrentMessage('');
    savedMessageIdsRef.current.clear();

    // Clear messages from Firestore
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        await fetch(`/api/projects/${projectId}/messages`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        });
      }
    } catch (err) {
      console.error('Failed to clear messages from server:', err);
    }
  }, [projectId]);

  // Manual deploy function (for Deploy button)
  const deployProject = useCallback(async () => {
    setIsDeploying(true);
    setError(null);

    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        throw new Error('Authentication required. Please sign in.');
      }

      // Require container to be ready for building
      if (!containerManager) {
        throw new Error('Workspace is still loading. Please wait for it to finish and try again.');
      }

      // Build the project first, then deploy built output
      let deployFiles: Record<string, string>;
      try {
        deployFiles = await containerManager.buildForDeploy();
      } catch (buildErr: any) {
        console.warn('Build failed:', buildErr.message);
        // Only fall back to source files if they're safe to deploy as-is
        // (no JSX/TSX files referenced from index.html)
        const indexHtml = files['index.html'] || '';
        const hasUnbundledCode = /\.(jsx|tsx|ts)\b/.test(indexHtml);
        if (hasUnbundledCode) {
          throw new Error(
            `Build failed: ${buildErr.message}. Your project uses JSX/TypeScript which must be compiled before deployment. Ask the AI to fix the build configuration.`
          );
        }
        // Simple HTML/CSS/JS project - source files are fine
        console.log('Deploying source files (no bundling needed)');
        deployFiles = files;
      }

      const response = await fetch(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: deployFiles }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Deployment failed');
      }

      setDeploymentUrl(result.url);
      return { success: true, url: result.url };
    } catch (err: any) {
      setError(err.message || 'Deployment failed');
      return { success: false, error: err.message };
    } finally {
      setIsDeploying(false);
    }
  }, [projectId, files, containerManager]);

  return {
    messages,
    currentMessage,
    setCurrentMessage,
    isLoading,
    isLoadingMessages,
    error,
    errorRetryable,
    files,
    recentlyChangedFiles,
    sendMessage,
    stopGeneration,
    clearChat,
    // Deployment
    isDeploying,
    deploymentUrl,
    deployProject,
  };
}
