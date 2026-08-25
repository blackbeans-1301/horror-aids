'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

const OPEN_KEY = 'horror-aids:jobs-sidebar-open';

interface JobsSidebarState {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const JobsSidebarContext = createContext<JobsSidebarState | null>(null);

// Shared between JobsSidebar (which renders the floating panel) and AppShell
// (which needs to know whether to make room for it) so the page's own
// content — e.g. the tab bar — never sits underneath the fixed-position
// panel and gets its clicks swallowed.
export const JobsSidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      if (raw !== null) {
        setIsOpen(JSON.parse(raw) as boolean);
      }
    } catch {
      // ignore malformed/inaccessible storage
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(isOpen));
    } catch {
      // best-effort persistence only
    }
  }, [isOpen]);

  return <JobsSidebarContext.Provider value={{ isOpen, setIsOpen }}>{children}</JobsSidebarContext.Provider>;
};

export function useJobsSidebarState(): JobsSidebarState {
  const ctx = useContext(JobsSidebarContext);
  if (!ctx) {
    throw new Error('useJobsSidebarState must be used within a JobsSidebarProvider');
  }
  return ctx;
}
