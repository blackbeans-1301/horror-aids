import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium min-h-6',
  {
    variants: {
      variant: {
        default: 'border-border bg-white/[0.06] text-muted-foreground',
        good: 'border-[var(--brand-2)] bg-[var(--brand-2-wash)] text-[#bde3ce]',
        warn: 'border-[rgba(200,143,61,0.5)] text-[#f4cf91]',
        bad: 'border-[rgba(223,93,77,0.5)] text-[#f2aea6]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
