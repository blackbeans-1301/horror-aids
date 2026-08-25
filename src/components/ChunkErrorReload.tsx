'use client';

import { useEffect } from 'react';

const RELOAD_GUARD_KEY = 'chunk-error-reload-at';
const RELOAD_GUARD_WINDOW_MS = 10_000;

function isChunkLoadError(message: string | undefined): boolean {
  if (!message) return false;
  return /ChunkLoadError|Loading chunk .* failed|Importing a module script failed/i.test(message);
}

function reloadOnce(): void {
  const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
  if (Date.now() - lastReload < RELOAD_GUARD_WINDOW_MS) return;
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

export function ChunkErrorReload(): null {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      if (isChunkLoadError(event.message) || isChunkLoadError(event.error?.name)) {
        reloadOnce();
      }
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const message = typeof reason === 'string' ? reason : reason?.message;
      if (isChunkLoadError(message) || isChunkLoadError(reason?.name)) {
        reloadOnce();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
