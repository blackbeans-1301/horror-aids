import Link from 'next/link';
import { AudioLines, BookOpen, Clapperboard, Settings } from 'lucide-react';

import { ScrollButtons } from '@/features/stories/components/ScrollButtons';

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
          <Link className="button secondary" href="/library">
            <BookOpen size={15} aria-hidden="true" />
            Thư viện truyện
          </Link>
          <Link className="button secondary" href="/media">
            <Clapperboard size={15} aria-hidden="true" />
            Media Library
          </Link>
          <Link className="button secondary" href="/settings">
            <Settings size={15} aria-hidden="true" />
            TTS Settings
          </Link>
        </nav>
      </header>
      {children}
      <ScrollButtons />
    </div>
  );
};

export default AppShell;
