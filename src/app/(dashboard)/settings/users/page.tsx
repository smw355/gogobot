'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    userId: string;
    action: 'demote' | 'disable' | 'enable';
    userName: string;
  } | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      fetchUsers();
    }
  }, [currentUser, fetchUsers]);

  const updateUser = async (userId: string, update: { role?: string; disabled?: boolean }) => {
    setUpdating(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      if (res.ok) {
        // Optimistic update
        setUsers(prev =>
          prev.map(u =>
            u.id === userId ? { ...u, ...update } as AdminUser : u
          )
        );
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update user');
      }
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setUpdating(null);
      setConfirmAction(null);
    }
  };

  const handleRoleToggle = (user: AdminUser) => {
    if (user.id === currentUser?.uid) return; // Can't change own role

    if (user.role === 'admin') {
      // Confirm before demoting admin
      setConfirmAction({ userId: user.id, action: 'demote', userName: user.displayName || user.email });
    } else {
      updateUser(user.id, { role: 'admin' });
    }
  };

  const handleDisableToggle = (user: AdminUser) => {
    if (user.id === currentUser?.uid) return; // Can't disable self

    if (!user.disabled) {
      // Confirm before disabling
      setConfirmAction({
        userId: user.id,
        action: 'disable',
        userName: user.displayName || user.email,
      });
    } else {
      updateUser(user.id, { disabled: false });
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (!currentUser || currentUser.role !== 'admin') return null;

  return (
    <div className="space-y-6">
      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-sm mx-4">
            <CardHeader>
              <CardTitle>
                {confirmAction.action === 'demote'
                  ? 'Remove Admin?'
                  : confirmAction.action === 'disable'
                    ? 'Disable Account?'
                    : 'Enable Account?'}
              </CardTitle>
              <CardDescription>
                {confirmAction.action === 'demote'
                  ? `${confirmAction.userName} will lose admin privileges and won't be able to access settings.`
                  : confirmAction.action === 'disable'
                    ? `${confirmAction.userName} will be logged out immediately and won't be able to sign in.`
                    : `${confirmAction.userName} will be able to sign in again.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmAction.action === 'enable' ? 'primary' : 'danger'}
                isLoading={updating === confirmAction.userId}
                onClick={() => {
                  if (confirmAction.action === 'demote') {
                    updateUser(confirmAction.userId, { role: 'user' });
                  } else if (confirmAction.action === 'disable') {
                    updateUser(confirmAction.userId, { disabled: true });
                  } else {
                    updateUser(confirmAction.userId, { disabled: false });
                  }
                }}
              >
                {confirmAction.action === 'demote'
                  ? 'Remove Admin'
                  : confirmAction.action === 'disable'
                    ? 'Disable Account'
                    : 'Enable Account'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users.length} {users.length === 1 ? 'user' : 'users'} on this instance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">No users found</p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {users.map((user) => {
                const isSelf = user.id === currentUser.uid;

                return (
                  <div key={user.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${
                          user.disabled
                            ? 'text-zinc-400 dark:text-zinc-600 line-through'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}>
                          {user.displayName || user.email}
                          {isSelf && (
                            <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">(you)</span>
                          )}
                        </span>

                        {/* Role badge */}
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}>
                          {user.role}
                        </span>

                        {/* Disabled badge */}
                        {user.disabled && (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {user.email}
                        {user.lastLoginAt && ` · Last login ${formatDate(user.lastLoginAt)}`}
                      </p>
                    </div>

                    {!isSelf && (
                      <div className="flex items-center gap-1 ml-4">
                        {/* Role toggle */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRoleToggle(user)}
                          isLoading={updating === user.id}
                          disabled={user.disabled}
                        >
                          {user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                        </Button>

                        {/* Disable/Enable toggle */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDisableToggle(user)}
                          isLoading={updating === user.id}
                          className={user.disabled ? 'text-green-600' : 'text-red-500 hover:text-red-700'}
                        >
                          {user.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      </div>
                    )}
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
