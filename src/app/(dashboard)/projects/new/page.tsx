'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAuth } from 'firebase/auth';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Globe, Database, Users, Sparkles, HelpCircle } from 'lucide-react';
import type { ProjectCategory } from '@/types';

const CATEGORIES: {
  value: ProjectCategory;
  label: string;
  description: string;
  examples: string;
  icon: React.ElementType;
}[] = [
  {
    value: 'static-website',
    label: 'Static Website',
    description: 'A site that displays content — no backend or saved data needed',
    examples: 'Portfolio, landing page, documentation, blog',
    icon: Globe,
  },
  {
    value: 'app-with-database',
    label: 'App with Database',
    description: 'Save, manage, and display data using a cloud database',
    examples: 'Task tracker, expense log, inventory, recipe book',
    icon: Database,
  },
  {
    value: 'multi-user-app',
    label: 'Multi-User App',
    description: 'Users sign up, different roles see different things',
    examples: 'Team dashboard, coaching platform, classroom, CRM',
    icon: Users,
  },
  {
    value: 'ai-powered-app',
    label: 'AI-Powered App',
    description: 'Uses AI models to chat, analyze, generate, or automate',
    examples: 'AI chatbot, document summarizer, writing tool, workflow agent',
    icon: Sparkles,
  },
  {
    value: 'something-else',
    label: 'Something Else',
    description: 'Not sure yet, or something that doesn\'t fit the categories above',
    examples: 'The AI will help you figure out the best approach',
    icon: HelpCircle,
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProjectCategory | null>(null);
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
        body: JSON.stringify({ name: name.trim(), category }),
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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Create New Project</CardTitle>
          <CardDescription>
            Choose what kind of app you want to build, then give it a name.
            We&apos;ll set up a dedicated cloud environment for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Category picker */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                What are you building?
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      disabled={loading}
                      onClick={() => setCategory(cat.value)}
                      className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-blue-500 text-white'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-sm font-medium ${
                          isSelected
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}>
                          {cat.label}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {cat.description}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 italic">
                          {cat.examples}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Project name */}
            <Input
              id="name"
              label="Project Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                category === 'static-website' ? 'My Portfolio Site' :
                category === 'app-with-database' ? 'Expense Tracker' :
                category === 'multi-user-app' ? 'Team Dashboard' :
                category === 'ai-powered-app' ? 'AI Writing Assistant' :
                'My Awesome App'
              }
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
              <Button type="submit" isLoading={loading} disabled={!name.trim() || !category}>
                Create Project
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
