'use client';

import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Lock, Plus, Trash2, X } from 'lucide-react';

interface Secret {
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SecretsPanelProps {
  projectId: string;
  onClose: () => void;
}

export function SecretsPanel({ projectId, onClose }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  async function getAuthHeaders() {
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  }

  async function fetchSecrets() {
    try {
      setError(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/projects/${projectId}/secrets`, { headers });
      if (!res.ok) throw new Error('Failed to load secrets');
      const data = await res.json();
      setSecrets(data.secrets || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSecrets();
  }, [projectId]);

  async function handleAdd() {
    if (!newName.trim() || !newValue.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/projects/${projectId}/secrets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: newName.trim().toUpperCase(), value: newValue }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save secret');
      }

      setNewName('');
      setNewValue('');
      await fetchSecrets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeletingName(name);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/projects/${projectId}/secrets`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete secret');
      }

      await fetchSecrets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingName(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Project Secrets
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
        Add API keys and secrets here. The AI will know they&apos;re available and use them when building your app.
        Values are stored securely and never shown in chat.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Existing secrets */}
      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-400">Loading secrets...</div>
      ) : secrets.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-400">
          No secrets yet. Add API keys below to use them in your app.
        </div>
      ) : (
        <div className="mb-4 space-y-2">
          {secrets.map((secret) => (
            <div
              key={secret.name}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
            >
              <div>
                <span className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {secret.name}
                </span>
                <span className="ml-3 text-sm text-zinc-400">••••••••</span>
              </div>
              <button
                onClick={() => handleDelete(secret.name)}
                disabled={deletingName === secret.name}
                className="rounded p-1 text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new secret */}
      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <div className="flex gap-2">
          <Input
            placeholder="SECRET_NAME"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            className="w-40 font-mono text-sm"
          />
          <Input
            type="password"
            placeholder="Secret value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="flex-1 text-sm"
          />
          <Button
            onClick={handleAdd}
            disabled={!newName.trim() || !newValue.trim() || saving}
            isLoading={saving}
            size="sm"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
