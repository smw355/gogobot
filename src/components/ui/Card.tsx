import { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface CardProps {
  className?: string;
  children: ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('border-b border-zinc-200 px-6 py-4 dark:border-zinc-800', className)}>
      {children}
    </div>
  );
}

export function CardContent({ className, children }: CardProps) {
  return <div className={cn('px-6 py-4', className)}>{children}</div>;
}

export function CardFooter({ className, children }: CardProps) {
  return (
    <div
      className={cn('border-t border-zinc-200 px-6 py-4 dark:border-zinc-800', className)}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: CardProps) {
  return (
    <h3 className={cn('text-lg font-semibold text-zinc-900 dark:text-zinc-100', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children }: CardProps) {
  return (
    <p className={cn('mt-1 text-sm text-zinc-600 dark:text-zinc-400', className)}>
      {children}
    </p>
  );
}
