'use client';

import { ChevronsDown, ChevronsUp } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

function getScrollState(): { atTop: boolean; atBottom: boolean; hasScroll: boolean } {
  const scrollY = window.scrollY;
  const viewport = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  return {
    atTop: scrollY <= 4,
    atBottom: scrollY + viewport >= documentHeight - 4,
    hasScroll: documentHeight > viewport + 4,
  };
}

export const ScrollButtons: React.FC = () => {
  const [{ atTop, atBottom, hasScroll }, setState] = useState(() => ({
    atTop: true,
    atBottom: true,
    hasScroll: false,
  }));

  const updateState = useCallback((): void => {
    setState(getScrollState());
  }, []);

  useEffect(() => {
    updateState();
    window.addEventListener('scroll', updateState, { passive: true });
    window.addEventListener('resize', updateState);
    return () => {
      window.removeEventListener('scroll', updateState);
      window.removeEventListener('resize', updateState);
    };
  }, [updateState]);

  if (!hasScroll) {
    return null;
  }

  return (
    <div className="scroll-fabs">
      <button
        className="scroll-fab"
        type="button"
        title="Lên đầu trang"
        disabled={atTop}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <ChevronsUp size={20} aria-hidden="true" />
      </button>
      <button
        className="scroll-fab"
        type="button"
        title="Xuống cuối trang"
        disabled={atBottom}
        onClick={() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
        }
      >
        <ChevronsDown size={20} aria-hidden="true" />
      </button>
    </div>
  );
};

export default ScrollButtons;
