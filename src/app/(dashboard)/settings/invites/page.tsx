'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import type { Invite, InviteStatus } from '@/types';
import { getAuth } from 'firebase/auth';

type FilterTab = 'all' | InviteStatus;

export default function InvitesPage() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

  // Invite link dialog
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState('');

  const getToken = useCallback(async () => {
    const auth = getAuth();
    return auth.currentUser?.getIdToken();
  }, []);

  const fetchInvites = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/invites', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites);
      }
    } catch (err) {
      console.error('Failed to fetch invites:', err);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchInvites();
    }
  }, [user, fetchInvites]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setCreating(true);

    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create invite');
        return;
      }

      setNewInviteUrl(data.inviteUrl);
      setShowLinkDialog(true);
      setEmail('');
      fetchInvites();
    } catch (err) {
      setError('Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const handleResend = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}`, {
        method: 'PATCH',
      });

      const data = await res.json();
      if (res.ok) {
        setNewInviteUrl(data.inviteUrl);
        setShowLinkDialog(true);
        fetchInvites();
      }
    } catch (err) {
      console.error('Failed to resend invite:', err);
    }
  };

  const handleDelete = async (inviteId: string) => {
    try {
      await fetch(`/api/admin/invites/${inviteId}`, { method: 'DELETE' });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch (err) {
      console.error('Failed to delete invite:', err);
    }
  };

  const handleCopyLink = async (invite: Invite) => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/login?invite=${invite.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      setNewInviteUrl(url);
      setShowLinkDialog(true);
    }
  };

  const getStatusColor = (invite: Invite) => {
    const isExpired = new Date(invite.expiresAt).getTime() < Date.now();
    if (invite.status === 'accepted') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (invite.status === 'expired' || isExpired) return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  };

  const getStatusLabel = (invite: Invite) => {
    const isExpired = new Date(invite.expiresAt).getTime() < Date.now();
    if (invite.status === 'accepted') return 'Accepted';
    if (invite.status === 'expired' || isExpired) return 'Expired';
    return 'Pending';
  };

  const filteredInvites = invites.filter(invite => {
    if (filter === 'all') return true;
    const isExpired = new Date(invite.expiresAt).getTime() < Date.now();
    if (filter === 'expired') return invite.status === 'expired' || (invite.status === 'pending' && isExpired);
    if (filter === 'pending') return invite.status === 'pending' && !isExpired;
    return invite.status === filter;
  });

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-6">
      {/* Invite link dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <CardTitle>Invite Link Created</CardTitle>
              <CardDescription>Share this link with the person you want to invite</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={newInviteUrl}
                  className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(newInviteUrl);
                    setSuccess('Copied!');
                    setTimeout(() => setSuccess(''), 2000);
                  }}
                >
                  {success === 'Copied!' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => { setShowLinkDialog(false); setSuccess(''); }}
                >
                  Done
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create invite */}
      <Card>
        <CardHeader>
          <CardTitle>Invite a User</CardTitle>
          <CardDescription>
            Send an invite to give someone access to this Gogobot instance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-3">
            <div className="flex-1">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
              />
            </div>
            <Button type="submit" isLoading={creating}>
              Send Invite
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {/* Invites list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Invites</CardTitle>
              <CardDescription>{invites.length} total invites</CardDescription>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-3">
            {(['all', 'pending', 'accepted', 'expired'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
            </div>
          ) : filteredInvites.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {filter === 'all' ? 'No invites yet' : `No ${filter} invites`}
            </p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredInvites.map((invite) => {
                const isPending = getStatusLabel(invite) === 'Pending';
                const isExpired = getStatusLabel(invite) === 'Expired';

                return (
                  <div key={invite.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {invite.email}
                        </span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(invite)}`}>
                          {getStatusLabel(invite)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Invited by {invite.invitedByEmail} on {formatDate(invite.createdAt)}
                        {isPending && ` · Expires ${formatDate(invite.expiresAt)}`}
                        {invite.status === 'accepted' && invite.acceptedAt && ` · Accepted ${formatDate(invite.acceptedAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      {isPending && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyLink(invite)}
                        >
                          {copiedId === invite.id ? 'Copied!' : 'Copy Link'}
                        </Button>
                      )}
                      {(isPending || isExpired) && invite.status !== 'accepted' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResend(invite.id)}
                        >
                          Resend
                        </Button>
                      )}
                      {invite.status !== 'accepted' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(invite.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
