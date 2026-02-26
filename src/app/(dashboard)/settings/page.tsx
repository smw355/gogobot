'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDbInstance } from '@/lib/firebase/config';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import type { InstanceConfig } from '@/types';

export default function SettingsGeneralPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<Partial<InstanceConfig> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instanceName, setInstanceName] = useState('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const db = getDbInstance();
        const configDoc = await getDoc(doc(db, 'config', 'instance'));
        if (configDoc.exists()) {
          const data = configDoc.data() as InstanceConfig;
          setConfig(data);
          setInstanceName(data.instanceName || '');
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadConfig();
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const db = getDbInstance();
      await updateDoc(doc(db, 'config', 'instance'), {
        instanceName: instanceName.trim(),
      });
      setConfig(prev => prev ? { ...prev, instanceName: instanceName.trim() } : null);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Instance Configuration</CardTitle>
          <CardDescription>
            Basic settings for your Gogobot deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            id="instanceName"
            label="Instance Name"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder="My Company Builder"
          />
          <Button onClick={handleSave} isLoading={saving}>
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GCP Configuration</CardTitle>
          <CardDescription>
            Google Cloud Platform settings (configured via environment variables)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Project ID:</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'Not configured'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Status:</span>
              <span className="text-green-600 dark:text-green-400">Connected</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Information</CardTitle>
          <CardDescription>
            Current administrator details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Email:</span>
              <span className="text-zinc-900 dark:text-zinc-100">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">Role:</span>
              <span className="text-zinc-900 dark:text-zinc-100 capitalize">{user.role}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
