'use client';

import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/Button';
import { ImageIcon, Trash2, X, Copy, Check, FileText, Type } from 'lucide-react';

interface Asset {
  name: string;
  contentType: string;
  size: number;
  url: string;
  uploadedAt: string | null;
}

interface AssetsPanelProps {
  projectId: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function AssetsPanel({ projectId, onClose }: AssetsPanelProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  async function getAuthHeaders() {
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  }

  async function fetchAssets() {
    try {
      setError(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/projects/${projectId}/assets`, { headers });
      if (!res.ok) throw new Error('Failed to load assets');
      const data = await res.json();
      setAssets(data.assets || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAssets();
  }, [projectId]);

  async function handleDelete(name: string) {
    setDeletingName(name);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/projects/${projectId}/assets`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ filename: name }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete asset');
      }
      await fetchAssets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingName(null);
    }
  }

  function handleCopyUrl(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Project Assets
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Upload images, logos, PDFs, and other files. The AI will use these in your app automatically.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-400">Loading assets...</div>
      ) : assets.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-400">
          No assets uploaded yet. Use the paperclip button in chat to upload images, logos, PDFs, and more.
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div
              key={asset.name}
              className="flex items-center gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-700"
            >
              {/* Thumbnail or icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                {isImage(asset.contentType) ? (
                  <img
                    src={asset.url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                ) : asset.contentType === 'application/pdf' ? (
                  <FileText className="h-5 w-5 text-red-500" />
                ) : (
                  <Type className="h-5 w-5 text-zinc-400" />
                )}
              </div>

              {/* Name + size */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {asset.name}
                </p>
                <p className="text-xs text-zinc-400">{formatSize(asset.size)}</p>
              </div>

              {/* Actions */}
              <button
                onClick={() => handleCopyUrl(asset.url)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                title="Copy URL"
              >
                {copiedUrl === asset.url ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => handleDelete(asset.name)}
                disabled={deletingName === asset.name}
                className="rounded p-1 text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title="Delete asset"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
