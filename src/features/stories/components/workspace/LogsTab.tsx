import React from 'react';

import type { JobRecord } from '@/types/story';

interface LogsTabProps {
  jobs: JobRecord[];
  selectedJob: JobRecord | null;
  jobLog: string;
  onSelectJob: (jobId: string) => void;
}

export const LogsTab: React.FC<LogsTabProps> = ({ jobs, selectedJob, jobLog, onSelectJob }) => {
  return (
    <section className="split">
      <div className="panel">
        <h2>Jobs</h2>
        <div className="story-list">
          {jobs.map((job) => (
            <button className="story-item" key={job.id} type="button" onClick={() => onSelectJob(job.id)}>
              <span className="status-line">
                <strong>{job.type}</strong>
                <span className="badge">{job.status}</span>
              </span>
              <span className="mono">{job.id}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Log</h2>
        <p>{selectedJob?.command.join(' ') ?? 'Select a job.'}</p>
        <pre className="log">{jobLog || 'No log selected.'}</pre>
      </div>
    </section>
  );
};

export default LogsTab;
