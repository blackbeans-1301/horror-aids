import Link from 'next/link';
import { AudioLines } from 'lucide-react';

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
        <span className="badge">Local audio studio</span>
      </header>
      {children}
    </div>
  );
};

export default AppShell;
