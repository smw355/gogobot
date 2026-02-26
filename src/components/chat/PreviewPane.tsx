'use client';

import { cn } from '@/lib/utils/cn';
import { highlightCode, HighlightedSegment } from '@/lib/utils/syntax-highlight';
import { Eye, Code, ExternalLink, RefreshCw, Server, Globe, FileCode, Folder, ChevronRight, Monitor, Tablet, Smartphone } from 'lucide-react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Spinner } from '@/components/ui';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const DEVICE_SIZES: Record<DeviceMode, { width: number; height: number; label: string } | null> = {
  desktop: null, // Full size
  tablet: { width: 768, height: 1024, label: 'iPad' },
  mobile: { width: 375, height: 812, label: 'iPhone' },
};

interface PreviewPaneProps {
  files: Record<string, string>;
  recentlyChangedFiles?: Set<string>;
  deploymentUrl?: string | null;
  previewUrl?: string | null;
  isLoading?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
}

interface BuildTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Record<string, BuildTreeNode>;
}

// Build a tree structure from flat file paths
function buildFileTree(files: Record<string, string>): FileTreeNode[] {
  const root: Record<string, BuildTreeNode> = {};

  Object.keys(files).sort().forEach(path => {
    const parts = path.split('/');
    let current = root;

    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          isDirectory: index < parts.length - 1,
          children: {},
        };
      }
      if (index < parts.length - 1) {
        current = current[part].children;
      }
    });
  });

  // Convert to array
  const toArray = (nodes: Record<string, BuildTreeNode>): FileTreeNode[] => {
    return Object.values(nodes).map(node => ({
      name: node.name,
      path: node.path,
      isDirectory: node.isDirectory,
      children: toArray(node.children),
    })).sort((a, b) => {
      // Directories first, then alphabetically
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };

  return toArray(root);
}

function FileTreeItem({
  node,
  depth,
  selectedFile,
  recentlyChangedFiles,
  onSelect
}: {
  node: FileTreeNode;
  depth: number;
  selectedFile: string | null;
  recentlyChangedFiles?: Set<string>;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isChanged = recentlyChangedFiles?.has(node.path);

  if (node.isDirectory) {
    const hasChangedChildren = node.children.some(child =>
      recentlyChangedFiles?.has(child.path) ||
      (child.isDirectory && child.children.some(c => recentlyChangedFiles?.has(c.path)))
    );

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          <Folder className={cn('h-3.5 w-3.5', hasChangedChildren ? 'text-green-500' : 'text-zinc-500')} />
          <span className="text-zinc-700 dark:text-zinc-300">{node.name}</span>
          {hasChangedChildren && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
        </button>
        {expanded && node.children.map(child => (
          <FileTreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFile={selectedFile}
            recentlyChangedFiles={recentlyChangedFiles}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex items-center gap-1.5 w-full px-2 py-1 text-left text-xs',
        selectedFile === node.path
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
        isChanged && 'bg-green-50 dark:bg-green-900/20'
      )}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <FileCode className={cn('h-3.5 w-3.5', isChanged ? 'text-green-500' : 'text-zinc-400')} />
      <span className="truncate">{node.name}</span>
      {isChanged && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
    </button>
  );
}

export function PreviewPane({
  files,
  recentlyChangedFiles,
  deploymentUrl,
  previewUrl,
  isLoading = false,
  className,
  style,
}: PreviewPaneProps) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [iframeKey, setIframeKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');

  const refreshPreview = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const fileCount = Object.keys(files).length;
  const hasFiles = fileCount > 0;
  const changedCount = recentlyChangedFiles?.size || 0;

  const sortedFiles = useMemo(() => Object.keys(files).sort(), [files]);

  // Track the most recently changed file for the code view sidebar
  // (don't force-switch to code view — let the user stay on preview)
  useEffect(() => {
    if (recentlyChangedFiles && recentlyChangedFiles.size > 0) {
      const changedFile = Array.from(recentlyChangedFiles)[0];
      if (files[changedFile]) {
        setSelectedFile(changedFile);
      }
    }
  }, [recentlyChangedFiles, files]);

  const activeFile = selectedFile && files[selectedFile] ? selectedFile : sortedFiles[0] || null;
  const activeContent = activeFile ? files[activeFile] : null;
  const isActiveFileChanged = activeFile && recentlyChangedFiles?.has(activeFile);

  const highlightedContent = useMemo<HighlightedSegment[]>(() => {
    if (!activeContent || !activeFile) {
      return [{ text: '// Select a file to view its contents', className: 'text-zinc-400' }];
    }
    return highlightCode(activeContent, activeFile);
  }, [activeContent, activeFile]);

  // Only use the WebContainer dev server URL for iframe embedding.
  // Deployment URLs (Firebase Hosting) block iframe embedding via X-Frame-Options.
  const activeUrl = previewUrl;
  const isLivePreview = !!previewUrl;

  const deviceSize = DEVICE_SIZES[deviceMode];

  // Empty state
  if (!hasFiles && !activeUrl && !isLoading) {
    return (
      <div className={cn('flex flex-col items-center justify-center bg-zinc-100 dark:bg-zinc-900', className)} style={style}>
        <div className="text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 mx-auto">
            <Eye className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Live Preview</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Your app will appear here as we build it
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && !activeUrl && !hasFiles) {
    return (
      <div className={cn('flex flex-col items-center justify-center bg-zinc-100 dark:bg-zinc-900', className)} style={style}>
        <div className="text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 mx-auto">
            <Spinner size="md" />
          </div>
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Starting Preview Server</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Your live preview will be available shortly
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)} style={style}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('preview')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'preview'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            )}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
          <button
            onClick={() => setView('code')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'code'
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            )}
          >
            <Code className="h-3.5 w-3.5" />
            Code
            {hasFiles && (
              <span className="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] dark:bg-zinc-700">
                {fileCount}
              </span>
            )}
            {changedCount > 0 && (
              <span className="ml-1 flex items-center gap-1 rounded-full bg-green-100 px-1.5 text-[10px] text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />
                {changedCount} changed
              </span>
            )}
          </button>

          {isLivePreview && (
            <span className="ml-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Device mode toggles (only in preview mode) */}
          {view === 'preview' && activeUrl && (
            <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 mr-2">
              {([
                { mode: 'desktop' as DeviceMode, icon: Monitor, title: 'Desktop' },
                { mode: 'tablet' as DeviceMode, icon: Tablet, title: 'Tablet (768px)' },
                { mode: 'mobile' as DeviceMode, icon: Smartphone, title: 'Mobile (375px)' },
              ]).map(({ mode, icon: Icon, title }) => (
                <button
                  key={mode}
                  onClick={() => setDeviceMode(mode)}
                  className={cn(
                    'p-1.5 transition-colors',
                    deviceMode === mode
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  )}
                  title={title}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}

          {activeUrl && view === 'preview' && (
            <button
              onClick={refreshPreview}
              className="flex items-center gap-1.5 rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="Refresh preview"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}

          {(activeUrl || deploymentUrl) && (
            <a
              href={activeUrl || deploymentUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {isLivePreview ? 'Open preview' : 'Open site'}
            </a>
          )}
        </div>
      </div>

      {/* Status bar for live preview */}
      {isLivePreview && view === 'preview' && (
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <Server className="h-3 w-3 text-zinc-400" />
          <span className="text-zinc-500 dark:text-zinc-400 truncate">{previewUrl}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-950">
        {view === 'preview' ? (
          activeUrl ? (
            deviceSize ? (
              // Device preview mode (tablet/mobile)
              <div className="relative flex h-full items-start justify-center overflow-auto bg-zinc-100 dark:bg-zinc-900 p-4 pb-8">
                <div
                  className="relative shrink-0 rounded-2xl border-4 border-zinc-800 dark:border-zinc-600 bg-white shadow-2xl overflow-hidden"
                  style={{
                    width: `${deviceSize.width}px`,
                    height: `${deviceSize.height}px`,
                    maxHeight: 'calc(100% - 2rem)',
                  }}
                >
                  {/* Device notch for mobile */}
                  {deviceMode === 'mobile' && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 w-28 h-6 bg-zinc-800 dark:bg-zinc-600 rounded-b-xl" />
                  )}
                  <iframe
                    key={`${iframeKey}-${deviceMode}`}
                    src={activeUrl}
                    className="h-full w-full border-0"
                    title="Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                  />
                </div>
                <div className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-zinc-400 dark:text-zinc-500">
                  {deviceSize.label} — {deviceSize.width} × {deviceSize.height}
                </div>
              </div>
            ) : (
              // Desktop preview (full size)
              <iframe
                key={iframeKey}
                src={activeUrl}
                className="h-full w-full border-0"
                title="Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              />
            )
          ) : deploymentUrl ? (
            <div className="flex h-full flex-col items-center justify-center">
              <Globe className="h-8 w-8 text-green-400 dark:text-green-500 mb-3" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Your app is deployed!</p>
              <p className="text-xs text-zinc-400 mt-1 mb-3">Live preview will appear once the workspace loads</p>
              <a
                href={deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open deployed site
              </a>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <Globe className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-500">Preview will appear when your app is running</p>
              <p className="text-xs text-zinc-400 mt-1">Start building to see your app come to life</p>
            </div>
          )
        ) : (
          <div className="flex h-full">
            {/* File tree sidebar */}
            <div className="w-48 border-r border-zinc-200 dark:border-zinc-800 overflow-auto">
              <div className="p-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Files
              </div>
              {hasFiles ? (
                <div className="pb-4">
                  {fileTree.map(node => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedFile={activeFile}
                      recentlyChangedFiles={recentlyChangedFiles}
                      onSelect={setSelectedFile}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-4 text-xs text-zinc-400">No files yet</div>
              )}
            </div>

            {/* Code view */}
            <div className="flex-1 overflow-auto">
              {activeFile && (
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {activeFile}
                  </span>
                  {isActiveFileChanged && (
                    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />
                      Modified
                    </span>
                  )}
                </div>
              )}
              <pre className="p-4 overflow-auto h-full bg-zinc-50 dark:bg-zinc-900">
                <code className="text-xs font-mono leading-relaxed whitespace-pre">
                  {highlightedContent.map((segment, i) => (
                    <span key={i} className={segment.className}>
                      {segment.text}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
