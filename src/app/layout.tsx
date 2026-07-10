import type { Metadata } from 'next';
import 'react-toastify/dist/ReactToastify.css';
import './globals.css';

import { ToastProvider } from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: 'Horror Aids',
  description: 'Local Vietnamese horror audio production studio',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): React.ReactElement {
  return (
    <html lang="en">
      <body>
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
