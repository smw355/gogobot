'use client';

import { useRef, useState } from 'react';
import { Paperclip, Loader2 } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { cn } from '@/lib/utils/cn';

interface FileUploadButtonProps {
  projectId: string;
  onUploadComplete: (assets: { name: string; url: string }[]) => void;
  disabled?: boolean;
}

export function FileUploadButton({ projectId, onUploadComplete, disabled }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleClick = () => {
    if (!uploading && !disabled) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const uploaded: { name: string; url: string }[] = [];

    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/projects/${projectId}/assets`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          body: formData,
        });

        const data = await res.json();
        if (res.ok && data.success) {
          uploaded.push({ name: data.filename, url: data.url });
        } else {
          console.error(`Failed to upload ${file.name}:`, data.error);
        }
      }

      if (uploaded.length > 0) {
        onUploadComplete(uploaded);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
      // Reset input so the same file can be uploaded again
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.svg,.woff,.woff2,.ttf,.json,.csv"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleClick}
        disabled={disabled || uploading}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
          (disabled || uploading) && 'cursor-not-allowed opacity-50'
        )}
        title={uploading ? 'Uploading...' : 'Upload files (images, PDFs, etc.)'}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
      </button>
    </>
  );
}
