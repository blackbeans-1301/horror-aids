import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
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
      <Card>
        <CardTitle>Jobs</CardTitle>
        <CardContent>
          <div className="story-list">
            {jobs.map((job) => (
              <Button
                variant="ghost"
                className="story-item h-auto w-full text-base font-normal"
                key={job.id}
                type="button"
                onClick={() => onSelectJob(job.id)}
              >
                <span className="status-line">
                  <strong>{job.type}</strong>
                  <Badge>{job.status}</Badge>
                </span>
                <span className="mono">{job.id}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardTitle>Log</CardTitle>
        <CardContent>
          <p>{selectedJob?.command.join(' ') ?? 'Select a job.'}</p>
          <pre className="log">{jobLog || 'No log selected.'}</pre>
        </CardContent>
      </Card>
    </section>
  );
};

export default LogsTab;
