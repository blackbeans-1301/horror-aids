import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>): React.ReactElement {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[56px] w-full rounded-md border border-input bg-[#161514] px-[11px] py-2.5 text-sm text-foreground leading-normal outline-none transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
