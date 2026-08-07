'use client';

import { Loader2, Square } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { JobRecord, JobType } from '@/types/story';

interface ActiveJobBannerProps {
  job: JobRecord;
  onViewLog: () => void;
  onStop: () => void;
  isStopping: boolean;
}

const jobLabels: Record<JobType, string> = {
  process_story: 'Processing story',
  generate_verify_tts: 'Generating + verifying audio',
  concat_audio: 'Concatenating final WAV',
};

function formatElapsed(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export const ActiveJobBanner: React.FC<ActiveJobBannerProps> = ({
  job,
  onViewLog,
  onStop,
  isStopping,
}) => {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => forceTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="job-banner" role="status">
      <Loader2 size={16} className="spin" aria-hidden="true" />
      <span>
        {jobLabels[job.type] ?? job.type} — running {formatElapsed(job.startedAt)}
      </span>
      <button className="button secondary" type="button" onClick={onViewLog}>
        View log
      </button>
      <button className="button danger" type="button" onClick={onStop} disabled={isStopping}>
        <Square size={14} aria-hidden="true" />
        {isStopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
};

export default ActiveJobBanner;
