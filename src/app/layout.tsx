import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

import { ChunkErrorReload } from '@/components/ChunkErrorReload';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { ToastProvider } from '@/components/ToastProvider';

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-sans' });
const fraunces = Fraunces({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-display',
  weight: ['500', '600'],
  style: ['normal', 'italic'],
});

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
      <body className={`${inter.variable} ${fraunces.variable}`}>
        <ChunkErrorReload />
        <ConfirmProvider>{children}</ConfirmProvider>
        <ToastProvider />
      </body>
    </html>
  );
}
