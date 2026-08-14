import React from 'react';

import { Card, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatLongDuration } from '@/features/stories/utils/format';
import type { JobType, SegmentRecord, StoryAnalytics } from '@/types/story';

interface AnalyticsTabProps {
  analytics: StoryAnalytics;
  segments: SegmentRecord[];
}

const JOB_LABELS: Record<JobType, string> = {
  process_story: 'Process story',
  generate_verify_tts: 'Generate + verify TTS',
  concat_audio: 'Concat audio',
  render_video: 'Render video',
};

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ analytics, segments }) => {
  const { phaseDurationsMs, jobs } = analytics;

  const activeSegments = segments.filter((segment) => segment.status !== 'skipped');
  const totalAttempts = activeSegments.reduce((sum, segment) => sum + segment.verification.attempts, 0);
  const passedCount = activeSegments.filter((segment) => segment.verification.status === 'passed').length;
  const failedCount = activeSegments.filter(
    (segment) =>
      segment.verification.status === 'failed' || segment.verification.status === 'max_attempts_reached',
  ).length;

  return (
    <Card>
      <div className="page-header">
        <div>
          <h2>Analytics</h2>
          <p>Timing across the pipeline, based on approval timestamps and job history.</p>
        </div>
      </div>

      <div className="settings-grid">
        <Card>
          <div className="label">{analytics.isComplete ? 'Total time (draft → complete)' : 'Elapsed so far'}</div>
          <CardTitle>{formatLongDuration(analytics.totalDurationMs)}</CardTitle>
          <p>
            Created {formatTimestamp(analytics.createdAt)}
            {analytics.isComplete ? ` · Completed ${formatTimestamp(analytics.finalAudioApprovedAt)}` : ''}
          </p>
        </Card>
        <Card>
          <div className="label">Draft → segments approved</div>
          <CardTitle>{formatLongDuration(phaseDurationsMs.draftToSegmentsApproved)}</CardTitle>
          <p>Time spent writing/editing before approving segments for TTS.</p>
        </Card>
        <Card>
          <div className="label">Segments approved → audio verified</div>
          <CardTitle>{formatLongDuration(phaseDurationsMs.segmentsApprovedToVerified)}</CardTitle>
          <p>Includes TTS generation, Whisper verification, and manual review.</p>
        </Card>
        <Card>
          <div className="label">Verified → final audio approved</div>
          <CardTitle>{formatLongDuration(phaseDurationsMs.verifiedToFinalApproved)}</CardTitle>
          <p>Time from confirming verified output to approving the concatenated final WAV.</p>
        </Card>
      </div>

      <h3>Job performance</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Runs</TableHead>
            <TableHead>Total time</TableHead>
            <TableHead>Avg per run</TableHead>
            <TableHead>Last finished</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.type}>
              <TableCell>{JOB_LABELS[job.type]}</TableCell>
              <TableCell className="mono">{job.runs}</TableCell>
              <TableCell className="mono">{formatLongDuration(job.totalDurationMs)}</TableCell>
              <TableCell className="mono">{formatLongDuration(job.averageDurationMs)}</TableCell>
              <TableCell>{formatTimestamp(job.lastFinishedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h3>Segment verification</h3>
      <div className="settings-grid">
        <Card>
          <div className="label">Segments</div>
          <CardTitle>{activeSegments.length}</CardTitle>
        </Card>
        <Card>
          <div className="label">Verification attempts (total)</div>
          <CardTitle>{totalAttempts}</CardTitle>
          <p>{activeSegments.length > 0 ? (totalAttempts / activeSegments.length).toFixed(1) : '0'} avg per segment</p>
        </Card>
        <Card>
          <div className="label">Passed</div>
          <CardTitle>{passedCount}</CardTitle>
        </Card>
        <Card>
          <div className="label">Failed / max attempts</div>
          <CardTitle>{failedCount}</CardTitle>
        </Card>
      </div>
    </Card>
  );
};

export default AnalyticsTab;
