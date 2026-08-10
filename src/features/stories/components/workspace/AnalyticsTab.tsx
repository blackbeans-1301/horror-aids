import React from 'react';

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
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>Analytics</h2>
          <p>Timing across the pipeline, based on approval timestamps and job history.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel">
          <div className="label">{analytics.isComplete ? 'Total time (draft → complete)' : 'Elapsed so far'}</div>
          <h3>{formatLongDuration(analytics.totalDurationMs)}</h3>
          <p>
            Created {formatTimestamp(analytics.createdAt)}
            {analytics.isComplete ? ` · Completed ${formatTimestamp(analytics.finalAudioApprovedAt)}` : ''}
          </p>
        </div>
        <div className="panel">
          <div className="label">Draft → segments approved</div>
          <h3>{formatLongDuration(phaseDurationsMs.draftToSegmentsApproved)}</h3>
          <p>Time spent writing/editing before approving segments for TTS.</p>
        </div>
        <div className="panel">
          <div className="label">Segments approved → audio verified</div>
          <h3>{formatLongDuration(phaseDurationsMs.segmentsApprovedToVerified)}</h3>
          <p>Includes TTS generation, Whisper verification, and manual review.</p>
        </div>
        <div className="panel">
          <div className="label">Verified → final audio approved</div>
          <h3>{formatLongDuration(phaseDurationsMs.verifiedToFinalApproved)}</h3>
          <p>Time from confirming verified output to approving the concatenated final WAV.</p>
        </div>
      </div>

      <h3>Job performance</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Runs</th>
              <th>Total time</th>
              <th>Avg per run</th>
              <th>Last finished</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.type}>
                <td>{JOB_LABELS[job.type]}</td>
                <td className="mono">{job.runs}</td>
                <td className="mono">{formatLongDuration(job.totalDurationMs)}</td>
                <td className="mono">{formatLongDuration(job.averageDurationMs)}</td>
                <td>{formatTimestamp(job.lastFinishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Segment verification</h3>
      <div className="settings-grid">
        <div className="panel">
          <div className="label">Segments</div>
          <h3>{activeSegments.length}</h3>
        </div>
        <div className="panel">
          <div className="label">Verification attempts (total)</div>
          <h3>{totalAttempts}</h3>
          <p>{activeSegments.length > 0 ? (totalAttempts / activeSegments.length).toFixed(1) : '0'} avg per segment</p>
        </div>
        <div className="panel">
          <div className="label">Passed</div>
          <h3>{passedCount}</h3>
        </div>
        <div className="panel">
          <div className="label">Failed / max attempts</div>
          <h3>{failedCount}</h3>
        </div>
      </div>
    </section>
  );
};

export default AnalyticsTab;
