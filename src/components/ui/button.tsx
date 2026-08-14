import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[filter,background-color,border-color] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border border-transparent hover:brightness-110',
        secondary:
          'bg-transparent text-foreground border border-border hover:border-ring hover:bg-accent',
        destructive: 'bg-transparent text-destructive border border-destructive/45 hover:brightness-110',
        ghost: 'bg-transparent text-foreground border border-transparent hover:bg-accent',
      },
      size: {
        default: 'h-[38px] px-3 py-2 has-[>svg]:px-3',
        sm: 'h-[30px] px-2.5 text-[13px]',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
