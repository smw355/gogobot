'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';

interface DashboardData {
  summary: {
    totalUsers: number;
    totalProjects: number;
    activeProjects: number;
    totalDeployments: number;
    statusCounts: Record<string, number>;
    gcpStatusCounts: Record<string, number>;
  };
  users: Array<{
    userId: string;
    email: string;
    displayName: string;
    role: string;
    projectCount: number;
    deploymentCount: number;
    enabledApisTotal: number;
    lastActive: string | null;
    projects: Array<{
      id: string;
      name: string;
      gcpProjectId: string | null;
      status: string;
      gcpStatus: string | null;
      enabledApis: string[];
      lastDeployed: string | null;
      hostingUrl: string | null;
      createdAt: string | null;
    }>;
  }>;
  errorProjects: Array<{
    id: string;
    name: string;
    userEmail: string;
    error: string | null;
  }>;
  recentProjects: Array<{
    id: string;
    name: string;
    userEmail: string;
    createdAt: string | null;
  }>;
}

interface CostsData {
  billingAccountId: string;
  totalBillingProjects: number;
  gogobotLinked: number;
  unlinked: number;
  perUser: Array<{
    userId: string;
    email: string;
    projectCount: number;
    billingEnabled: number;
  }>;
  note: string;
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin') return;

    async function fetchData() {
      const [dashRes, costsRes] = await Promise.all([
        fetch('/api/admin/dashboard').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/admin/costs').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (dashRes) setDashboard(dashRes);
      if (costsRes) {
        if (costsRes.error) {
          setCostsError(costsRes.error);
        } else {
          setCosts(costsRes);
        }
      }
      setLoading(false);
    }

    fetchData();
  }, [user]);

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const formatRelative = (date: string | null) => {
    if (!date) return 'Never';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(date);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ready: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      provisioning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      deleted: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
      deployed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      active: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    };
    return colors[status] || 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  };

  if (!user || user.role !== 'admin') return null;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!dashboard) {
    return <p className="text-center text-zinc-500 py-8">Failed to load dashboard data.</p>;
  }

  const { summary } = dashboard;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Users" value={summary.totalUsers} />
        <StatCard label="Total Projects" value={summary.totalProjects} />
        <StatCard label="Active Projects" value={summary.activeProjects} />
        <StatCard label="Deployments" value={summary.totalDeployments} />
      </div>

      {/* GCP Status breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>GCP Project Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary.gcpStatusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadge(status)}`}>
                  {status}
                </span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{count}</span>
              </div>
            ))}
            {Object.keys(summary.gcpStatusCounts).length === 0 && (
              <p className="text-sm text-zinc-500">No GCP projects yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error projects */}
      {dashboard.errorProjects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Projects in Error State</CardTitle>
            <CardDescription>{dashboard.errorProjects.length} project(s) need attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {dashboard.errorProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                    <p className="text-xs text-zinc-500">{p.userEmail}</p>
                  </div>
                  {p.error && (
                    <p className="text-xs text-red-600 dark:text-red-400 max-w-xs truncate">{p.error}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-user table */}
      <Card>
        <CardHeader>
          <CardTitle>Per-User Summary</CardTitle>
          <CardDescription>Click a user to see their projects</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {dashboard.users.map((u) => (
              <div key={u.userId}>
                <button
                  onClick={() => setExpandedUser(expandedUser === u.userId ? null : u.userId)}
                  className="flex w-full items-center justify-between py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 -mx-2 px-2 rounded transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {u.displayName || u.email}
                      </p>
                      {u.role === 'admin' && (
                        <span className="text-xs rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          admin
                        </span>
                      )}
                    </div>
                    {u.displayName && (
                      <p className="text-xs text-zinc-500">{u.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-6 ml-4 text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
                    <span>{u.projectCount} projects</span>
                    <span>{u.deploymentCount} deploys</span>
                    <span>{u.enabledApisTotal} APIs</span>
                    <span className="w-16 text-right">{formatRelative(u.lastActive)}</span>
                    <svg
                      className={`h-4 w-4 transition-transform ${expandedUser === u.userId ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Expanded project list */}
                {expandedUser === u.userId && u.projects.length > 0 && (
                  <div className="mb-3 ml-4 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400">
                          <th className="px-3 py-2 text-left font-medium">Project</th>
                          <th className="px-3 py-2 text-left font-medium">GCP ID</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                          <th className="px-3 py-2 text-left font-medium">APIs</th>
                          <th className="px-3 py-2 text-left font-medium">Last Deployed</th>
                          <th className="px-3 py-2 text-left font-medium">URL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {u.projects.map((p) => (
                          <tr key={p.id} className="text-zinc-700 dark:text-zinc-300">
                            <td className="px-3 py-2 font-medium">{p.name}</td>
                            <td className="px-3 py-2">
                              {p.gcpProjectId ? (
                                <button
                                  onClick={() => copyToClipboard(p.gcpProjectId!)}
                                  className="font-mono hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                  title="Click to copy"
                                >
                                  {copied === p.gcpProjectId ? 'Copied!' : p.gcpProjectId}
                                </button>
                              ) : (
                                <span className="text-zinc-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadge(p.status)}`}>
                                  {p.status}
                                </span>
                                {p.gcpStatus && p.gcpStatus !== 'ready' && (
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadge(p.gcpStatus)}`}>
                                    GCP: {p.gcpStatus}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">{p.enabledApis.length}</td>
                            <td className="px-3 py-2">{formatRelative(p.lastDeployed)}</td>
                            <td className="px-3 py-2">
                              {p.hostingUrl ? (
                                <a
                                  href={p.hostingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  View
                                </a>
                              ) : (
                                <span className="text-zinc-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {expandedUser === u.userId && u.projects.length === 0 && (
                  <p className="mb-3 ml-4 text-xs text-zinc-500">No projects</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Billing section */}
      <Card>
        <CardHeader>
          <CardTitle>Billing & Resources</CardTitle>
          <CardDescription>
            Projects linked to billing account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {costsError ? (
            <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                Could not load billing data: {costsError}
              </p>
              <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                Ensure the service account has <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">roles/billing.viewer</code> on the billing account.
              </p>
            </div>
          ) : costs ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Billing Projects</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{costs.totalBillingProjects}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Gogobot-Linked</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{costs.gogobotLinked}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Unlinked</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{costs.unlinked}</p>
                </div>
              </div>

              {costs.perUser.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Per-User Billing Projects</h3>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {costs.perUser.map((u) => (
                      <div key={u.userId} className="flex items-center justify-between py-2">
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">{u.email}</span>
                        <span className="text-sm text-zinc-500">{u.projectCount} projects ({u.billingEnabled} billing-enabled)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">{costs.note}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading billing data...</p>
          )}
        </CardContent>
      </Card>

      {/* Recent projects */}
      <Card>
        <CardHeader>
          <CardTitle>Recently Created Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {dashboard.recentProjects.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                  <p className="text-xs text-zinc-500">{p.userEmail}</p>
                </div>
                <span className="text-xs text-zinc-500">{formatDate(p.createdAt)}</span>
              </div>
            ))}
            {dashboard.recentProjects.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-500">No projects yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}
