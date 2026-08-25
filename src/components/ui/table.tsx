import * as React from 'react';

import { cn } from '@/lib/utils';

function Table({ className, ...props }: React.ComponentProps<'table'>): React.ReactElement {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full min-w-[720px] border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>): React.ReactElement {
  return <thead data-slot="table-header" className={cn(className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>): React.ReactElement {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />;
}

const TableRow = React.forwardRef<HTMLTableRowElement, React.ComponentProps<'tr'>>(
  function TableRow({ className, ...props }, ref): React.ReactElement {
    return (
      <tr
        ref={ref}
        data-slot="table-row"
        className={cn('transition-colors hover:bg-accent', className)}
        {...props}
      />
    );
  },
);

function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.ReactElement {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'border-b border-border py-2.5 px-2 text-left align-top text-xs font-normal uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.ReactElement {
  return (
    <td
      data-slot="table-cell"
      className={cn('border-b border-border py-2.5 px-2 align-top', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
