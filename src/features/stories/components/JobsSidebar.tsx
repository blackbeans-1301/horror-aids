'use client';

import { Check, CheckCheck, ChevronDown, ChevronRight, ListChecks, PanelLeftClose } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useJobsSidebarState } from '@/features/stories/hooks/useJobsSidebarState';
import type { TabId } from '@/features/stories/hooks/useStoryWorkspace';
import type { JobRecord, JobStatus, JobType, StoryIndexEntry } from '@/types/story';

// process_story is intentionally left out of the sidebar — it's a fast,
// unattended step the user doesn't need to watch or confirm.
const GROUP_ORDER: JobType[] = ['generate_verify_tts', 'concat_audio', 'render_video'];

const GROUP_LABELS: Record<JobType, string> = {
  process_story: 'Processing stories',
  generate_verify_tts: 'Generating TTS',
  concat_audio: 'Concatenating audio',
  render_video: 'Rendering video',
};

// Where "go look at the finished job" should land — the tab that shows the
// output of each job type.
const DONE_TAB: Record<JobType, TabId> = {
  process_story: 'segments',
  generate_verify_tts: 'audio',
  concat_audio: 'audio',
  render_video: 'video',
};

const DEFAULT_EXPANDED: Record<JobType, boolean> = {
  process_story: true,
  generate_verify_tts: true,
  concat_audio: true,
  render_video: true,
};

const EXPANDED_KEY = 'horror-aids:jobs-sidebar-expanded';
const MAX_FINISHED_PER_GROUP = 8;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence only — a private-browsing quota error shouldn't break the sidebar
  }
}

function statusMeta(status: JobStatus): { label: string; variant: 'default' | 'good' | 'warn' | 'bad' } {
  switch (status) {
    case 'pending':
      return { label: 'Queued', variant: 'warn' };
    case 'running':
      return { label: 'Running', variant: 'warn' };
    case 'needs_review':
      return { label: 'Needs review', variant: 'warn' };
    case 'complete':
      return { label: 'Complete', variant: 'good' };
    case 'failed':
      return { label: 'Failed', variant: 'bad' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'default' };
    default:
      return { label: status, variant: 'default' };
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

interface JobRowProps {
  job: JobRecord;
  title: string;
  onConfirm: () => void;
  onView: () => void;
}

const JobRow: React.FC<JobRowProps> = ({ job, title, onConfirm, onView }) => {
  const isDone = job.finishedAt !== null;
  const { label, variant } = statusMeta(job.status);
  const elapsedMs =
    (isDone ? new Date(job.finishedAt as string).getTime() : Date.now()) - new Date(job.startedAt).getTime();

  return (
    <div className="rounded-md border border-border bg-background/40 p-2" data-job-id={job.id}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{title}</span>
        <Badge variant={variant} className="shrink-0">
          {label}
        </Badge>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{formatDuration(elapsedMs)}</div>
      <div className="mt-1.5 flex gap-1.5">
        <Button variant="secondary" size="sm" type="button" onClick={onView}>
          View
        </Button>
        {isDone ? (
          <Button variant="ghost" size="sm" type="button" onClick={onConfirm}>
            <Check size={13} aria-hidden="true" />
            Confirm
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export const JobsSidebar: React.FC = () => {
  const router = useRouter();
  const { isOpen, setIsOpen } = useJobsSidebarState();
  const [hydrated, setHydrated] = useState(false);
  const [expanded, setExpanded] = useState<Record<JobType, boolean>>(DEFAULT_EXPANDED);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [titleById, setTitleById] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLElement | null>(null);

  // Click-outside-to-close: this floats over the page like a popover, so a
  // click anywhere outside it should dismiss it rather than staying pinned
  // open until the user finds the collapse button again.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, setIsOpen]);

  // Read persisted UI state after mount only, so the very first client render
  // matches the server-rendered HTML (both use the hardcoded defaults above)
  // and localStorage never causes a hydration mismatch.
  useEffect(() => {
    setExpanded(loadJSON(EXPANDED_KEY, DEFAULT_EXPANDED));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveJSON(EXPANDED_KEY, expanded);
  }, [hydrated, expanded]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [jobsRes, storiesRes] = await Promise.all([fetch('/api/jobs'), fetch('/api/stories')]);
        if (!cancelled && jobsRes.ok) {
          const data = (await jobsRes.json()) as { jobs: JobRecord[] };
          setJobs(data.jobs);
        }
        if (!cancelled && storiesRes.ok) {
          const data = (await storiesRes.json()) as { stories: StoryIndexEntry[] };
          const map: Record<string, string> = {};
          for (const story of data.stories) {
            map[story.id] = story.title;
          }
          setTitleById(map);
        }
      } catch {
        // Best-effort background polling — a transient failure here shouldn't
        // surface a toast on every page in the app.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Confirmation is persisted server-side on the job record itself (data/jobs.json),
  // not in localStorage — it survives a redeploy/restart and isn't tied to one browser.
  const confirmedSet = useMemo(
    () => new Set(jobs.filter((job) => job.confirmedAt).map((job) => job.id)),
    [jobs],
  );

  const grouped = useMemo(() => {
    const active: Record<JobType, JobRecord[]> = {
      process_story: [],
      generate_verify_tts: [],
      concat_audio: [],
      render_video: [],
    };
    const finished: Record<JobType, JobRecord[]> = {
      process_story: [],
      generate_verify_tts: [],
      concat_audio: [],
      render_video: [],
    };
    for (const job of jobs) {
      if (job.status === 'pending' || job.status === 'running') {
        active[job.type]?.push(job);
      } else if (!confirmedSet.has(job.id)) {
        finished[job.type]?.push(job);
      }
    }
    const byStartedDesc = (a: JobRecord, b: JobRecord): number =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();

    const byType: Record<JobType, { jobs: JobRecord[]; hiddenCount: number }> = {
      process_story: { jobs: [], hiddenCount: 0 },
      generate_verify_tts: { jobs: [], hiddenCount: 0 },
      concat_audio: { jobs: [], hiddenCount: 0 },
      render_video: { jobs: [], hiddenCount: 0 },
    };
    for (const type of GROUP_ORDER) {
      active[type].sort(byStartedDesc);
      finished[type].sort(byStartedDesc);
      // Confirming is opt-in and this app has a long job history, so cap how
      // many finished-but-unconfirmed jobs pile up per group — otherwise the
      // very first use of this feature dumps months of old jobs into view.
      // Older ones are still reachable from each story's own Logs tab.
      const visibleFinished = finished[type].slice(0, MAX_FINISHED_PER_GROUP);
      byType[type] = {
        jobs: [...active[type], ...visibleFinished],
        hiddenCount: finished[type].length - visibleFinished.length,
      };
    }
    return byType;
  }, [jobs, confirmedSet]);

  const totalCount = GROUP_ORDER.reduce((sum, type) => sum + grouped[type].jobs.length, 0);

  // All finished jobs across every displayed group, not just the ones
  // currently visible under the per-group cap — "confirm all" should clear
  // the whole backlog in one go, not just this page of it.
  const confirmableCount = useMemo(() => {
    return jobs.filter(
      (job) => job.finishedAt !== null && GROUP_ORDER.includes(job.type) && !confirmedSet.has(job.id),
    ).length;
  }, [jobs, confirmedSet]);

  const confirmJob = (jobId: string): void => {
    const confirmedAt = new Date().toISOString();
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, confirmedAt } : job)));
    void fetch(`/api/jobs/${jobId}/confirm`, { method: 'POST' }).catch(() => {
      // Best-effort — the next 5s poll will reconcile if this failed.
    });
  };

  const confirmAll = (): void => {
    const confirmedAt = new Date().toISOString();
    setJobs((current) =>
      current.map((job) => (job.finishedAt !== null && !job.confirmedAt ? { ...job, confirmedAt } : job)),
    );
    void fetch('/api/jobs/confirm-all', { method: 'POST' }).catch(() => {
      // Best-effort — the next 5s poll will reconcile if this failed.
    });
  };

  const viewJob = (job: JobRecord): void => {
    if (job.finishedAt !== null && !job.confirmedAt) {
      confirmJob(job.id);
    }
    router.push(`/stories/${job.storyId}?tab=${DONE_TAB[job.type]}`);
  };

  const toggleGroup = (type: JobType): void => {
    setExpanded((current) => ({ ...current, [type]: !current[type] }));
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Show job queue"
        className="fixed left-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-lg border border-l-0 border-border bg-card px-2 py-3 text-muted-foreground shadow-xl transition-colors hover:border-ring hover:text-foreground"
      >
        <ListChecks size={18} aria-hidden="true" />
        {totalCount > 0 ? (
          <span className="rounded-full bg-[var(--brand-wash)] px-1.5 text-[11px] font-semibold text-[var(--brand)]">
            {totalCount}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside
      ref={panelRef}
      className="fixed left-3 top-[84px] bottom-4 z-40 flex w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks size={16} aria-hidden="true" />
          Job queue
          {totalCount > 0 ? <Badge variant="warn">{totalCount}</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          {confirmableCount > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={confirmAll}
              title={`Confirm all finished jobs (${confirmableCount})`}
            >
              <CheckCheck size={16} aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" type="button" onClick={() => setIsOpen(false)} title="Hide job queue">
            <PanelLeftClose size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-2">
        {totalCount === 0 ? (
          <p className="px-1.5 py-3 text-xs text-muted-foreground">No jobs running.</p>
        ) : (
          GROUP_ORDER.map((type) => {
            const { jobs: list, hiddenCount } = grouped[type];
            if (list.length === 0) {
              return null;
            }
            const isExpanded = expanded[type];
            return (
              <div key={type} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(type)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    {isExpanded ? (
                      <ChevronDown size={14} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} aria-hidden="true" />
                    )}
                    {GROUP_LABELS[type]}
                  </span>
                  <span>{list.length}</span>
                </button>
                {isExpanded ? (
                  <div className="mt-1 grid gap-1.5">
                    {list.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        title={titleById[job.storyId] ?? job.storyId}
                        onConfirm={() => confirmJob(job.id)}
                        onView={() => viewJob(job)}
                      />
                    ))}
                    {hiddenCount > 0 ? (
                      <p className="px-1.5 py-1 text-xs text-muted-foreground">
                        +{hiddenCount} older, finished job(s) — see each story&apos;s Logs tab.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default JobsSidebar;
