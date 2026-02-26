'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth } from 'firebase/auth';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';

export default function NewProjectPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    setLoading(true);
    setError('');
    setStatus('Creating project...');

    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        throw new Error('Authentication required. Please sign in.');
      }

      setStatus('Setting up cloud infrastructure...');

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      setStatus('Ready! Redirecting...');
      router.push(`/projects/${data.id}`);
    } catch (err: any) {
      console.error('Create project error:', err);
      setError(err.message || 'Failed to create project');
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Create New Project</CardTitle>
          <CardDescription>
            Give your project a name. We&apos;ll set up a dedicated cloud environment for it.
            This usually takes about a minute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="name"
              label="Project Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome App"
              required
              disabled={loading}
            />

            {status && (
              <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
                {status}
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => router.back()} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" isLoading={loading} disabled={!name.trim()}>
                Create Project
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
