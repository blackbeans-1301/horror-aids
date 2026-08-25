import Link from 'next/link';
import { AudioLines, BookOpen, Clapperboard, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { JobsSidebar } from '@/features/stories/components/JobsSidebar';
import { ScrollButtons } from '@/features/stories/components/ScrollButtons';
import { ShellBody } from '@/features/stories/components/ShellBody';
import { JobsSidebarProvider } from '@/features/stories/hooks/useJobsSidebarState';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <AudioLines size={18} aria-hidden="true" />
          </span>
          <span>Horror Aids</span>
        </Link>
        <nav className="topnav">
          <Button asChild variant="secondary">
            <Link href="/library">
              <BookOpen size={15} aria-hidden="true" />
              Thư viện truyện
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/media">
              <Clapperboard size={15} aria-hidden="true" />
              Media Library
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/settings">
              <Settings size={15} aria-hidden="true" />
              TTS Settings
            </Link>
          </Button>
        </nav>
      </header>
      <JobsSidebarProvider>
        <ShellBody>{children}</ShellBody>
        <JobsSidebar />
      </JobsSidebarProvider>
      <ScrollButtons />
    </div>
  );
};

export default AppShell;
