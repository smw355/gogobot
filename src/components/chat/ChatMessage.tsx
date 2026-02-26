'use client';

import { Message, ToolCall } from '@/lib/ai/types';
import { cn } from '@/lib/utils/cn';
import {
  User,
  Bot,
  FileEdit,
  Terminal,
  CheckCircle,
  XCircle,
  Search,
  AlertTriangle,
  Package,
  Trash2,
  FolderOpen,
  FileText,
  Rocket,
  Cloud,
  ScrollText,
  Globe,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  isLastMessage?: boolean;
  isGenerating?: boolean;
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'writeFile':
      return <FileEdit className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
    case 'patchFile':
      return <FileEdit className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
    case 'readFile':
      return <FileText className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-500" />;
    case 'deleteFile':
      return <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />;
    case 'listFiles':
      return <FolderOpen className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-500" />;
    case 'runCommand':
      return <Terminal className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />;
    case 'searchFiles':
      return <Search className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />;
    case 'getErrors':
      return <AlertTriangle className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />;
    case 'getConsoleOutput':
      return <Terminal className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-500" />;
    case 'installPackage':
      return <Package className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
    case 'deploy':
      return <Rocket className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
    case 'getProjectInfo':
      return <Cloud className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />;
    case 'enableApi':
      return <Cloud className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
    case 'viewLogs':
      return <ScrollText className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-500" />;
    case 'gcpRequest':
      return <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />;
    default:
      return <Terminal className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-500" />;
  }
}

function getToolLabel(toolCall: { name: string; args: Record<string, any> }) {
  switch (toolCall.name) {
    case 'writeFile':
      return `Created ${toolCall.args.path}`;
    case 'patchFile':
      return `Edited ${toolCall.args.path}`;
    case 'readFile':
      return `Read ${toolCall.args.path}`;
    case 'deleteFile':
      return `Deleted ${toolCall.args.path}`;
    case 'listFiles':
      return `Listed ${toolCall.args.path || 'project files'}`;
    case 'runCommand':
      return `Ran: ${toolCall.args.command}`;
    case 'searchFiles':
      return `Searched for "${toolCall.args.pattern}"`;
    case 'getErrors':
      return 'Checked for errors';
    case 'getConsoleOutput':
      return 'Checked console';
    case 'installPackage':
      return `Installed ${toolCall.args.packageName}`;
    case 'deploy':
      return 'Deployed project';
    case 'getProjectInfo':
      return 'Checked cloud infrastructure';
    case 'enableApi':
      return `Enabled ${toolCall.args.apiName || 'API'}`;
    case 'viewLogs':
      return `Viewed ${toolCall.args.service ? toolCall.args.service + ' ' : ''}logs`;
    case 'gcpRequest': {
      const method = (toolCall.args.method || 'GET').toUpperCase();
      try {
        const url = new URL(toolCall.args.url || '');
        const service = url.hostname.split('.')[0];
        return `${method} ${service}.googleapis.com`;
      } catch {
        return `GCP API ${method} request`;
      }
    }
    default:
      return toolCall.name;
  }
}

/** Get a human-friendly summary of what the tool calls accomplished */
function getActivitySummary(toolCalls: ToolCall[]): string {
  const counts = {
    filesCreated: 0,
    filesEdited: 0,
    filesDeleted: 0,
    commands: 0,
    packages: 0,
    cloudOps: 0,
    checks: 0,
    deployed: false,
  };

  for (const tc of toolCalls) {
    switch (tc.name) {
      case 'writeFile': counts.filesCreated++; break;
      case 'patchFile': counts.filesEdited++; break;
      case 'deleteFile': counts.filesDeleted++; break;
      case 'runCommand': counts.commands++; break;
      case 'installPackage': counts.packages++; break;
      case 'deploy': counts.deployed = true; break;
      case 'getProjectInfo':
      case 'enableApi':
      case 'gcpRequest':
        counts.cloudOps++; break;
      default:
        counts.checks++; break;
    }
  }

  const parts: string[] = [];
  const totalFiles = counts.filesCreated + counts.filesEdited;
  if (totalFiles > 0) parts.push(`${totalFiles} file${totalFiles !== 1 ? 's' : ''} updated`);
  if (counts.filesDeleted > 0) parts.push(`${counts.filesDeleted} deleted`);
  if (counts.packages > 0) parts.push(`${counts.packages} package${counts.packages !== 1 ? 's' : ''} installed`);
  if (counts.commands > 0) parts.push(`${counts.commands} command${counts.commands !== 1 ? 's' : ''} run`);
  if (counts.cloudOps > 0) parts.push(`${counts.cloudOps} cloud operation${counts.cloudOps !== 1 ? 's' : ''}`);
  if (counts.deployed) parts.push('deployed');

  if (parts.length === 0) return `${toolCalls.length} action${toolCalls.length !== 1 ? 's' : ''}`;
  return parts.join(', ');
}

/** Check if a tool call has expandable detail output */
function hasDetailOutput(tc: ToolCall): boolean {
  if (!tc.result) return false;
  if (tc.result.success === false && tc.result.error) return true;
  if ((tc.name === 'runCommand' || tc.name === 'installPackage') && (tc.result.stdout || tc.result.stderr)) return true;
  if (tc.name === 'searchFiles' && tc.result.matches?.length > 0) return true;
  if (tc.name === 'getErrors' && tc.result.errors?.length > 0) return true;
  if (tc.name === 'getConsoleOutput' && tc.result.output?.length > 0) return true;
  if (tc.name === 'getProjectInfo' && tc.result.success && (tc.result.gcpProjectId || tc.result.gcpProject)) return true;
  if (tc.name === 'gcpRequest' && tc.result.data) return true;
  if (tc.name === 'viewLogs' && tc.result.logs?.length > 0) return true;
  return false;
}

/** Render the expandable detail content for a tool call */
function ToolCallDetails({ toolCall }: { toolCall: ToolCall }) {
  if (!toolCall.result) return null;

  return (
    <div className="mt-1.5 pl-6 text-xs">
      {/* Command output */}
      {(toolCall.name === 'runCommand' || toolCall.name === 'installPackage') && (
        <>
          {toolCall.result.stdout && (
            <pre className="text-zinc-500 dark:text-zinc-500 whitespace-pre-wrap max-h-32 overflow-auto">
              {toolCall.result.stdout}
            </pre>
          )}
          {toolCall.result.stderr && (
            <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap max-h-32 overflow-auto">
              {toolCall.result.stderr}
            </pre>
          )}
        </>
      )}

      {/* Search results */}
      {toolCall.name === 'searchFiles' && toolCall.result.matches?.length > 0 && (
        <div className="max-h-32 overflow-auto">
          {toolCall.result.matches.slice(0, 10).map((match: any, i: number) => (
            <div key={i} className="text-zinc-500 dark:text-zinc-500">
              <span className="font-medium text-cyan-700 dark:text-cyan-400">{match.file}:{match.line}</span>
              {' '}{match.content}
            </div>
          ))}
          {toolCall.result.count > 10 && (
            <p className="text-zinc-400 mt-1">...and {toolCall.result.count - 10} more</p>
          )}
        </div>
      )}

      {/* Errors from getErrors */}
      {toolCall.name === 'getErrors' && toolCall.result.errors?.length > 0 && (
        <div className="rounded bg-red-50 dark:bg-red-900/20 px-2 py-1 max-h-32 overflow-auto">
          {toolCall.result.errors.map((err: string, i: number) => (
            <p key={i} className="text-red-600 dark:text-red-400">{err}</p>
          ))}
        </div>
      )}

      {/* Console output */}
      {toolCall.name === 'getConsoleOutput' && toolCall.result.output?.length > 0 && (
        <pre className="text-zinc-500 dark:text-zinc-500 whitespace-pre-wrap max-h-32 overflow-auto">
          {toolCall.result.output.join('\n')}
        </pre>
      )}

      {/* Cloud project info */}
      {toolCall.name === 'getProjectInfo' && toolCall.result.success && (
        <div className="text-zinc-500 dark:text-zinc-500 space-y-0.5">
          {toolCall.result.gcpProjectId && (
            <p><span className="font-medium">Project:</span> {toolCall.result.gcpProjectId}</p>
          )}
          {toolCall.result.provisioningStatus && (
            <p><span className="font-medium">Status:</span> {toolCall.result.provisioningStatus}</p>
          )}
          {toolCall.result.hostingUrl && (
            <p><span className="font-medium">URL:</span> {toolCall.result.hostingUrl}</p>
          )}
        </div>
      )}

      {/* GCP Request result */}
      {toolCall.name === 'gcpRequest' && toolCall.result.data && (
        <div className="space-y-1">
          {toolCall.result.status && (
            <p className={toolCall.result.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
              {toolCall.result.status} {toolCall.result.statusText}
            </p>
          )}
          <pre className="text-zinc-500 dark:text-zinc-500 whitespace-pre-wrap max-h-32 overflow-auto rounded bg-zinc-100 dark:bg-zinc-800/50 p-1.5">
            {typeof toolCall.result.data === 'string'
              ? toolCall.result.data
              : JSON.stringify(toolCall.result.data, null, 2).slice(0, 1500)}
          </pre>
        </div>
      )}

      {/* Cloud logs */}
      {toolCall.name === 'viewLogs' && toolCall.result.logs?.length > 0 && (
        <pre className="text-zinc-500 dark:text-zinc-500 whitespace-pre-wrap max-h-32 overflow-auto">
          {toolCall.result.logs.map((l: any) => l.message || l).join('\n')}
        </pre>
      )}

      {/* Error for failed tool calls */}
      {toolCall.result.success === false && toolCall.result.error && (
        <div className="rounded bg-red-50 dark:bg-red-900/20 px-2 py-1">
          <p className="text-red-600 dark:text-red-400">{toolCall.result.error}</p>
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, isLastMessage, isGenerating }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const toolCalls = message.toolCalls || [];
  const hasToolCalls = toolCalls.length > 0;
  const isStillWorking = isLastMessage && isGenerating && hasToolCalls;
  const failedCalls = toolCalls.filter(tc => tc.result?.success === false);
  const hasFailed = failedCalls.length > 0;

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-4',
        isUser ? 'bg-zinc-50 dark:bg-zinc-900/50' : 'bg-white dark:bg-zinc-950'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-zinc-200 dark:bg-zinc-700'
            : 'bg-zinc-900 dark:bg-zinc-100'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
        ) : (
          <Bot className="h-4 w-4 text-white dark:text-zinc-900" />
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        {/* Text content */}
        {message.content && (
          <div className="prose prose-zinc dark:prose-invert max-w-none">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {message.content}
            </p>
          </div>
        )}

        {/* Collapsible tool calls activity section */}
        {hasToolCalls && (
          <details
            className="group rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30"
            open={isStillWorking || hasFailed}
          >
            <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
              {isStillWorking ? (
                <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
              ) : hasFailed ? (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              )}
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {isStillWorking
                  ? `Working... (${toolCalls.length} action${toolCalls.length !== 1 ? 's' : ''})`
                  : getActivitySummary(toolCalls)
                }
              </span>
              {hasFailed && !isStillWorking && (
                <span className="text-xs text-red-500 dark:text-red-400">
                  ({failedCalls.length} failed)
                </span>
              )}
            </summary>

            {/* Individual tool call rows */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-1.5 space-y-0.5">
              {toolCalls.map((toolCall, index) => {
                const showDetails = hasDetailOutput(toolCall);
                const isFailed = toolCall.result?.success === false;
                const isPending = !toolCall.result;

                return (
                  <div key={index}>
                    {showDetails ? (
                      <details open={isFailed}>
                        <summary className="flex items-center gap-2 py-1 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-zinc-100 dark:hover:bg-zinc-800/50 -mx-1 px-1 rounded">
                          <ChevronRight className="h-3 w-3 text-zinc-300 dark:text-zinc-600 transition-transform [details[open]>&]:rotate-90 shrink-0" />
                          {getToolIcon(toolCall.name)}
                          <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                            {getToolLabel(toolCall)}
                          </span>
                          <span className="ml-auto shrink-0">
                            {isPending ? (
                              <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
                            ) : isFailed ? (
                              <XCircle className="h-3 w-3 text-red-500" />
                            ) : (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            )}
                          </span>
                        </summary>
                        <ToolCallDetails toolCall={toolCall} />
                      </details>
                    ) : (
                      <div className="flex items-center gap-2 py-1 -mx-1 px-1">
                        <span className="w-3" /> {/* Spacer to align with expandable rows */}
                        {getToolIcon(toolCall.name)}
                        <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                          {getToolLabel(toolCall)}
                        </span>
                        <span className="ml-auto shrink-0">
                          {isPending ? (
                            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
                          ) : isFailed ? (
                            <XCircle className="h-3 w-3 text-red-500" />
                          ) : (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
