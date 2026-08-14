'use client';

import { Toaster } from '@/components/ui/sonner';

export const ToastProvider: React.FC = () => (
  <Toaster position="bottom-left" richColors closeButton visibleToasts={3} />
);

export default ToastProvider;
