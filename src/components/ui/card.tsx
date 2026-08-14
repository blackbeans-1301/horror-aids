import * as React from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card"
      className={cn('rounded-lg border border-border bg-card p-[18px] text-card-foreground', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-4 mb-3', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>): React.ReactElement {
  return <h3 data-slot="card-title" className={cn('text-base font-semibold leading-none', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>): React.ReactElement {
  return (
    <p data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return <div data-slot="card-content" className={cn('grid gap-3', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2.5 flex-wrap mt-3', className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
