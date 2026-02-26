'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import Link from 'next/link';

interface AdminProject {
  id: string;
  name: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: string;
  gcpStatus: string | null;
  deploymentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

type StatusFilter = 'all' | 'active' | 'deployed' | 'error' | 'deleted';

export default function AdminProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchProjects();
    }
  }, [user, fetchProjects]);

  const filteredProjects = useMemo(() => {
    let result = projects;

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(p => p.status === statusFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.userName.toLowerCase().includes(q) ||
        p.userEmail.toLowerCase().includes(q)
      );
    }

    return result;
  }, [projects, statusFilter, search]);

  const handleDelete = async (projectId: string) => {
    if (!confirm('Delete this project? It can be restored later.')) return;

    setUpdating(projectId);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev =>
          prev.map(p => p.id === projectId ? { ...p, status: 'deleted', deletedAt: new Date().toISOString() } : p)
        );
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    } finally {
      setUpdating(null);
    }
  };

  const handleRestore = async (projectId: string) => {
    setUpdating(projectId);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) {
        setProjects(prev =>
          prev.map(p => p.id === projectId ? { ...p, status: 'active', deletedAt: null } : p)
        );
      }
    } catch (err) {
      console.error('Failed to restore project:', err);
    } finally {
      setUpdating(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'deployed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'deploying': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'error': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'deleted': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500';
      default: return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Projects</CardTitle>
              <CardDescription>
                {projects.length} total projects across all users
              </CardDescription>
            </div>
          </div>

          {/* Search and filter */}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Input
                id="search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or owner..."
              />
            </div>
            <div className="flex gap-1">
              {(['all', 'active', 'deployed', 'error', 'deleted'] as StatusFilter[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === tab
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {search || statusFilter !== 'all' ? 'No matching projects' : 'No projects yet'}
            </p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredProjects.map((project) => (
                <div key={project.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100 truncate"
                      >
                        {project.name}
                      </Link>
                      <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                      {project.gcpStatus && project.gcpStatus !== 'ready' && (
                        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(project.gcpStatus)}`}>
                          GCP: {project.gcpStatus}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {project.userName || project.userEmail}
                      {project.userName && project.userEmail && ` (${project.userEmail})`}
                      {' · '}Updated {formatDate(project.updatedAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 ml-4">
                    {project.deploymentUrl && (
                      <a
                        href={project.deploymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        View Live
                      </a>
                    )}
                    <Link href={`/projects/${project.id}`}>
                      <Button variant="ghost" size="sm">
                        Open
                      </Button>
                    </Link>
                    {project.status === 'deleted' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRestore(project.id)}
                        isLoading={updating === project.id}
                        className="text-green-600"
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(project.id)}
                        isLoading={updating === project.id}
                        className="text-red-500 hover:text-red-700"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
