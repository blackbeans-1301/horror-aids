'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

// This app has exactly one (dark) theme, so — unlike shadcn's default
// template — theme is hardcoded rather than read from next-themes.
const Toaster = ({ ...props }: ToasterProps): React.ReactElement => (
  <Sonner
    theme="dark"
    className="toaster group"
    style={
      {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
