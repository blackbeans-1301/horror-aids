import { useEffect, useState } from 'react';

import { mediaApi } from '@/features/stories/api/mediaApi';
import type { ConfigGrade } from '@/lib/grade';

// Global grade default (config/app.json's video.grade) — the fallback level
// of resolveGrade's story > asset > config precedence. Fetched once; the
// app has no UI to edit this value live, so no polling/invalidation needed.
export function useVideoGradeConfig(): ConfigGrade | null {
  const [config, setConfig] = useState<ConfigGrade | null>(null);
  useEffect(() => {
    void mediaApi.videoGradeConfig().then(setConfig);
  }, []);
  return config;
}
