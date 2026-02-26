'use client';

import { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils/cn';

const tabs = [
  { href: '/settings', label: 'General' },
  { href: '/settings/users', label: 'Users' },
  { href: '/settings/invites', label: 'Invites' },
  { href: '/settings/projects', label: 'Projects' },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect non-admins
  if (!loading && user && user.role !== 'admin') {
    router.push('/projects');
    return null;
  }

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 overflow-y-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Manage your Gogobot instance
        </p>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab) => {
          const isActive = tab.href === '/settings'
            ? pathname === '/settings'
            : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-zinc-100" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
