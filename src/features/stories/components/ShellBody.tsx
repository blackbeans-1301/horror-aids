'use client';

import React from 'react';

import { useJobsSidebarState } from '@/features/stories/hooks/useJobsSidebarState';

interface ShellBodyProps {
  children: React.ReactNode;
}

// Reserves room for the floating job-queue sidebar when it's open, so the
// page's own content (e.g. the tab bar) never sits underneath the
// fixed-position panel where clicks would be swallowed by it.
export const ShellBody: React.FC<ShellBodyProps> = ({ children }) => {
  const { isOpen } = useJobsSidebarState();

  return (
    <div className={`transition-[margin] duration-150 ${isOpen ? 'ml-[340px]' : ''}`}>{children}</div>
  );
};

export default ShellBody;
