import 'server-only';

import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { probeIntegratedLufs, probeMediaMetadata } from '@/lib/media-probe';
import { ALL_YOUTUBE_METADATA_FIELD_GROUPS, generateYoutubeMetadataFields } from '@/lib/openai-metadata';
import { stripHighlightText } from '@/lib/thumbnail-prompt';
import { normalizeStoryText } from '@/lib/text-normalize';
import { renderYoutubeDescription, slugifyForHashtag } from '@/lib/youtube-description';
import {
  configRoot,
  dataRoot,
  mediaCategoryDir,
  mediaManifestPath,
  mediaRoot,
  projectRoot,
  resolveStoryPath,
  slugify,
  storiesRoot,
  storyDir,
  toPosixPath,
  voicePreviewCacheRoot,
} from '@/lib/paths';
import type {
  ApprovalStatus,
  AudioMediaAsset,
  CharactersFile,
  GradeOverride,
  JobRecord,
  JobsFile,
  JobStatus,
  JobType,
  JobTypeAnalytics,
  MediaAsset,
  MediaCategory,
  MediaLibraryFile,
  SegmentRecord,
  SegmentsFile,
  SourceType,
  StoryAnalytics,
  StoryDetail,
  StoryIndex,
  StoryIndexEntry,
  StoryRecord,
  VideoMediaAsset,
  VideoPlanFile,
  VideoRenderReceipt,
  VideoRenderSummary,
  VoiceRecord,
  VoicesFile,
  YoutubeMetadataFieldGroup,
  YoutubeMetadataFile,
} from '@/types/story';

const JOB_TYPES: JobType[] = ['process_story', 'generate_verify_tts', 'concat_audio', 'render_video'];

const MEDIA_CATEGORIES: MediaCategory[] = [
  'bg_music',
  'rain_ambience',
  'intro_music',
  'scene_video',
];

interface VideoAppConfig {
  introDurationMs?: number;
  leadInMs?: number;
  tailOutMs?: number;
  transitionMs?: number;
  defaultGainDb?: { introMusic?: number; bgMusic?: number; rainAmbience?: number };
  grade?: { brightness?: number; saturation?: number; vignette?: boolean };
}

const DEFAULT_VIDEO_CONFIG: Required<Omit<VideoAppConfig, 'defaultGainDb' | 'grade'>> & {
  defaultGainDb: Required<NonNullable<VideoAppConfig['defaultGainDb']>>;
  grade: Required<NonNullable<VideoAppConfig['grade']>>;
} = {
  introDurationMs: 8000,
  leadInMs: 800,
  tailOutMs: 4000,
  transitionMs: 1000,
  defaultGainDb: { introMusic: -3, bgMusic: -22, rainAmbience: -26 },
  grade: { brightness: -0.05, saturation: 0.85, vignette: false },
};

export async function readVideoAppConfig(): Promise<typeof DEFAULT_VIDEO_CONFIG> {
  const configPath = path.join(configRoot, 'app.json');
  const config = await readJsonFile<{ video?: VideoAppConfig }>(configPath, {});
  return {
    ...DEFAULT_VIDEO_CONFIG,
    ...config.video,
    defaultGainDb: { ...DEFAULT_VIDEO_CONFIG.defaultGainDb, ...config.video?.defaultGainDb },
    grade: { ...DEFAULT_VIDEO_CONFIG.grade, ...config.video?.grade },
  };
}

function computeStoryAnalytics(story: StoryRecord, storyJobs: JobRecord[]): StoryAnalytics {
  const jobs: JobTypeAnalytics[] = JOB_TYPES.map((type) => {
    const runsOfType = storyJobs.filter((job) => job.type === type);
    const completed = runsOfType.filter((job) => job.finishedAt !== null);
    const totalDurationMs = completed.reduce(
      (sum, job) => sum + (new Date(job.finishedAt as string).getTime() - new Date(job.startedAt).getTime()),
      0,
    );
    const lastFinishedAt = completed
      .map((job) => job.finishedAt as string)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
    return {
      type,
      runs: runsOfType.length,
      completedRuns: completed.length,
      totalDurationMs,
      averageDurationMs: completed.length > 0 ? totalDurationMs / completed.length : null,
      lastFinishedAt,
    };
  });

  const segmentsApprovedAt = story.approvals.segments.approvedAt;
  const verifiedAudioApprovedAt = story.approvals.verifiedAudio.approvedAt;
  const finalAudioApprovedAt = story.approvals.finalAudio.approvedAt;
  const createdMs = new Date(story.createdAt).getTime();

  const msBetween = (from: string | null, to: string | null): number | null => {
    if (!from || !to) {
      return null;
    }
    return new Date(to).getTime() - new Date(from).getTime();
  };

  return {
    createdAt: story.createdAt,
    segmentsApprovedAt,
    verifiedAudioApprovedAt,
    finalAudioApprovedAt,
    isComplete: finalAudioApprovedAt !== null,
    totalDurationMs: (finalAudioApprovedAt ? new Date(finalAudioApprovedAt).getTime() : Date.now()) - createdMs,
    phaseDurationsMs: {
      draftToSegmentsApproved: msBetween(story.createdAt, segmentsApprovedAt),
      segmentsApprovedToVerified: msBetween(segmentsApprovedAt, verifiedAudioApprovedAt),
      verifiedToFinalApproved: msBetween(verifiedAudioApprovedAt, finalAudioApprovedAt),
    },
    jobs,
  };
}

const indexPath = path.join(dataRoot, 'index.json');
const jobsPath = path.join(dataRoot, 'jobs.json');
const voicesPath = path.join(dataRoot, 'voices.json');
const voicesDir = path.join(dataRoot, 'voices');

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content);
  try {
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // tmpPath lives in the same directory as filePath, so this only
      // happens when that directory was removed concurrently (e.g. a story
      // getting deleted mid-write via deleteStoryPermanently). The write is
      // moot at that point — there's nothing left on disk to update — so
      // drop it instead of surfacing an unhandled rejection.
      await fs.unlink(tmpPath).catch(() => {});
      console.warn(`atomicWrite: destination directory disappeared before rename could complete: ${filePath}`);
      return;
    }
    throw error;
  }
}

// Ingests a file already on this machine without reading it through the
// browser/HTTP round trip a <input type="file"> upload requires — the
// operator gives an absolute path, and the server (which runs on their own
// machine) copies it directly on disk. COPYFILE_FICLONE asks for an APFS
// copy-on-write clone (instant, ~0 extra disk) and transparently falls back
// to a normal byte copy if the source/dest aren't on a filesystem that
// supports it — see docs/Specification Documents/09_WORKSPACE_ISOLATION_SPEC.md's
// use of the same `clonefile` mechanism for snapshotting.
async function copyLocalFile(sourcePath: string, destPath: string): Promise<void> {
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat) {
    throw new Error(`File not found: ${sourcePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${sourcePath}`);
  }
  if (stat.size === 0) {
    throw new Error(`File is empty: ${sourcePath}`);
  }

  await ensureDir(path.dirname(destPath));
  const tmpPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(sourcePath, tmpPath, fsConstants.COPYFILE_FICLONE);
  try {
    await fs.rename(tmpPath, destPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.unlink(tmpPath).catch(() => {});
      console.warn(`copyLocalFile: destination directory disappeared before rename could complete: ${destPath}`);
      return;
    }
    throw error;
  }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function writeTextFile(filePath: string, data: string): Promise<void> {
  await atomicWrite(filePath, data);
}

export async function readTextFile(filePath: string, fallback = ''): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

export async function ensureDataFiles(): Promise<void> {
  await ensureDir(dataRoot);
  await ensureDir(storiesRoot);

  if (!(await pathExists(indexPath))) {
    await writeJsonFile<StoryIndex>(indexPath, { stories: [] });
  }

  if (!(await pathExists(jobsPath))) {
    await writeJsonFile<JobsFile>(jobsPath, { jobs: [] });
  }

  if (!(await pathExists(voicesPath))) {
    await writeJsonFile<VoicesFile>(voicesPath, { voices: [] });
  }

  await ensureDir(mediaRoot);
  await Promise.all(MEDIA_CATEGORIES.map((category) => ensureDir(mediaCategoryDir(category))));
  if (!(await pathExists(mediaManifestPath))) {
    await writeJsonFile<MediaLibraryFile>(mediaManifestPath, { schemaVersion: 1, media: [] });
  }
}

export async function readStoryIndex(): Promise<StoryIndex> {
  await ensureDataFiles();
  return readJsonFile<StoryIndex>(indexPath, { stories: [] });
}

export async function writeStoryIndex(index: StoryIndex): Promise<void> {
  await writeJsonFile(indexPath, index);
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only checks whether the pid exists and is
    // ours to signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

const STALE_JOB_ERROR =
  'Worker process is no longer running (its exit was never recorded — most likely the app ' +
  'server restarted while the job was in progress).';

// A "running" job whose pid is dead was orphaned by something outside this
// app's control (a server restart losing the in-memory child handle, the
// machine sleeping, a hard kill). Left alone it stays "running" forever —
// blocking new jobs for that story and making Stop a no-op. Fix it the same
// way a normal partial run would leave things: mark the job failed and
// recompute the story's status from whatever segments actually finished.
async function reconcileStoryAfterStaleJob(job: JobRecord): Promise<void> {
  if (job.type !== 'generate_verify_tts') {
    return;
  }
  const story = await readStory(job.storyId);
  if (story.status !== 'tts_running' && story.audio.status !== 'running') {
    return;
  }
  const segments = await readSegments(job.storyId);
  const unresolved = segments.segments.filter(
    (segment) => segment.status !== 'skipped' && segment.verification.status !== 'passed',
  ).length;
  await patchStory(job.storyId, (current) => ({
    ...current,
    status: unresolved === 0 ? 'tts_verified' : 'audio_validation',
    audio: { ...current.audio, status: unresolved === 0 ? 'verified' : 'failed' },
  }));
}

// A job records its pid within milliseconds of spawning. One still holding
// null well after that never got a process at all — the server died between
// claiming the job and spawning it. Left alone it blocks its story forever,
// and for a TTS job it also holds a slot in the global queue, stalling every
// other story behind it.
const MISSING_PID_GRACE_MS = 60_000;

async function reconcileStaleJobs(jobs: JobsFile): Promise<JobsFile> {
  const stale = jobs.jobs.filter((job) => {
    if (job.status !== 'running') {
      return false;
    }
    if (job.pid == null) {
      return Date.now() - new Date(job.startedAt).getTime() > MISSING_PID_GRACE_MS;
    }
    return !isProcessAlive(job.pid);
  });
  if (stale.length === 0) {
    return jobs;
  }

  const staleIds = new Set(stale.map((job) => job.id));
  const finishedAt = new Date().toISOString();
  const reconciledJobs = jobs.jobs.map((job) =>
    staleIds.has(job.id)
      ? { ...job, status: 'failed' as JobStatus, finishedAt, error: STALE_JOB_ERROR }
      : job,
  );
  await writeJobs({ jobs: reconciledJobs });
  await Promise.all(stale.map((job) => reconcileStoryAfterStaleJob(job)));
  return { jobs: reconciledJobs };
}

export async function readJobs(): Promise<JobsFile> {
  await ensureDataFiles();
  const jobs = await readJsonFile<JobsFile>(jobsPath, { jobs: [] });
  return reconcileStaleJobs(jobs);
}

export async function writeJobs(jobs: JobsFile): Promise<void> {
  await writeJsonFile(jobsPath, jobs);
}

// data/jobs.json is mutated from several independent async paths — enqueueing
// a job, recording its pid, the queue pump claiming the next job, and every
// child's exit handler. Each is a read → await → write cycle, so two of them
// interleaving silently drops one update: a finished job stuck on "running"
// forever, or a queued job claimed twice and spawned twice. Every mutation
// goes through this chain so they run one at a time.
//
// NOT reentrant: code already holding the lock must use readJobs/writeJobs
// directly rather than calling back into updateJob.
let jobsMutation: Promise<unknown> = Promise.resolve();

export function withJobsLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = jobsMutation.then(operation, operation);
  jobsMutation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function updateJob(
  jobId: string,
  patch: Partial<Pick<JobRecord, 'status' | 'pid' | 'startedAt' | 'finishedAt' | 'error' | 'confirmedAt'>>,
): Promise<void> {
  await withJobsLock(async () => {
    const jobs = await readJobs();
    const updatedJobs = jobs.jobs.map((job) =>
      job.id === jobId ? { ...job, ...patch } : job,
    );
    await writeJobs({ jobs: updatedJobs });
  });
}

// Confirming a finished job dismisses it from the sidebar's unread backlog —
// persisted server-side (not localStorage) so it survives a redeploy/restart
// and is shared across whichever browser/device the operator uses.
export async function confirmJob(jobId: string): Promise<void> {
  await updateJob(jobId, { confirmedAt: new Date().toISOString() });
}

export async function confirmAllFinishedJobs(): Promise<void> {
  await withJobsLock(async () => {
    const jobs = await readJobs();
    const now = new Date().toISOString();
    const updatedJobs = jobs.jobs.map((job) =>
      job.finishedAt !== null && !job.confirmedAt ? { ...job, confirmedAt: now } : job,
    );
    await writeJobs({ jobs: updatedJobs });
  });
}

export async function createStory(input: {
  title: string;
  sourceType?: SourceType;
  storyText?: string;
  sourceContentId?: string | null;
}): Promise<StoryRecord> {
  await ensureDataFiles();
  const now = new Date().toISOString();
  const index = await readStoryIndex();
  const baseSlug = slugify(input.title);
  let slug = baseSlug;
  let suffix = 2;

  while (index.stories.some((story) => story.id === slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const root = storyDir(slug);
  await Promise.all([
    ensureDir(path.join(root, 'text')),
    ensureDir(path.join(root, 'audio', 'segments')),
    ensureDir(path.join(root, 'video')),
    ensureDir(path.join(root, 'metadata')),
    ensureDir(path.join(root, 'logs')),
    ensureDir(path.join(root, 'tmp', 'whisper')),
  ]);

  const story: StoryRecord = {
    id: slug,
    title: input.title.trim(),
    language: 'vi',
    sourceType: input.sourceType ?? 'manual',
    sourceUrl: null,
    rightsStatus: 'original',
    status: 'story_draft',
    createdAt: now,
    updatedAt: now,
    archived: false,
    archivedAt: null,
    sourceContentId: input.sourceContentId ?? null,
    text: {
      storyPath: 'text/story.md',
      charactersPath: 'text/characters.json',
      segmentsPath: 'text/segments.json',
    },
    approvals: {
      segments: { status: 'pending', approvedAt: null },
      verifiedAudio: { status: 'pending', approvedAt: null },
      finalAudio: { status: 'pending', approvedAt: null },
      finalVideo: { status: 'pending', approvedAt: null },
      metadata: { status: 'pending', approvedAt: null },
    },
    audio: {
      segmentsDir: 'audio/segments',
      finalPath: 'audio/final.m4a',
      status: 'pending',
    },
    video: {
      planPath: 'video/plan.json',
      finalPath: 'video/final.mp4',
      status: 'pending',
      durationMs: null,
      renderedAt: null,
    },
    metadata: {
      path: 'metadata/youtube.json',
      status: 'pending',
    },
  };

  await writeJsonFile(resolveStoryPath(slug, 'story.json'), story);
  await writeTextFile(
    resolveStoryPath(slug, story.text.storyPath),
    normalizeStoryText(input.storyText ?? ''),
  );
  await writeJsonFile<CharactersFile>(resolveStoryPath(slug, story.text.charactersPath), {
    characters: [
      {
        id: 'narrator',
        name: 'Narrator',
        role: 'narrator',
        voice: 'male-1',
      },
    ],
  });
  await writeJsonFile<SegmentsFile>(resolveStoryPath(slug, story.text.segmentsPath), {
    segments: [],
  });
  await writeTextFile(resolveStoryPath(slug, 'metadata/notes.md'), '');

  const entry: StoryIndexEntry = {
    id: story.id,
    title: story.title,
    status: story.status,
    language: story.language,
    sourceType: story.sourceType,
    storyPath: `stories/${story.id}/story.json`,
    updatedAt: story.updatedAt,
    archived: story.archived,
    archivedAt: story.archivedAt,
    sourceContentId: story.sourceContentId,
  };
  await writeStoryIndex({ stories: [entry, ...index.stories] });

  return story;
}

export async function readStory(slug: string): Promise<StoryRecord> {
  const story = await readJsonFile<StoryRecord | null>(resolveStoryPath(slug, 'story.json'), null);
  if (!story) {
    throw new Error(`Story not found: ${slug}`);
  }
  // Stories created before the archive/library-import/video-assembly/
  // youtube-metadata features shipped have no archived/archivedAt/
  // sourceContentId/approvals.finalVideo/approvals.metadata/video/metadata
  // fields on disk.
  return {
    ...story,
    archived: story.archived ?? false,
    archivedAt: story.archivedAt ?? null,
    sourceContentId: story.sourceContentId ?? null,
    approvals: {
      ...story.approvals,
      finalVideo: story.approvals?.finalVideo ?? { status: 'pending', approvedAt: null },
      metadata: story.approvals?.metadata ?? { status: 'pending', approvedAt: null },
    },
    video: story.video ?? {
      planPath: 'video/plan.json',
      finalPath: 'video/final.mp4',
      status: 'pending',
      durationMs: null,
      renderedAt: null,
    },
    metadata: story.metadata ?? {
      path: 'metadata/youtube.json',
      status: 'pending',
    },
  };
}

async function writeStory(story: StoryRecord): Promise<void> {
  const updatedStory = { ...story, updatedAt: new Date().toISOString() };
  await writeJsonFile(resolveStoryPath(story.id, 'story.json'), updatedStory);
  const index = await readStoryIndex();
  await writeStoryIndex({
    stories: index.stories.map((entry) =>
      entry.id === story.id
        ? {
            ...entry,
            title: updatedStory.title,
            status: updatedStory.status,
            sourceType: updatedStory.sourceType,
            updatedAt: updatedStory.updatedAt,
            archived: updatedStory.archived,
            archivedAt: updatedStory.archivedAt,
            sourceContentId: updatedStory.sourceContentId,
          }
        : entry,
    ),
  });
}

export async function patchStory(
  slug: string,
  updater: (story: StoryRecord) => StoryRecord,
): Promise<StoryRecord> {
  const current = await readStory(slug);
  const next = updater(current);
  await writeStory(next);
  return readStory(slug);
}

// The MVP's stated policy is "archive is the only removal-from-view
// mechanism, no hard delete" (see 02_LOCAL_WORKSPACE_SPEC.md) — this is a
// deliberate, narrow exception for cleaning up throwaway test workspaces
// that would otherwise clutter the Archived tab forever. Only reachable on
// an already-archived story (enforced here, not just in the UI), which
// means it's already been through the "are you sure" of archiving once.
export async function deleteStoryPermanently(slug: string): Promise<void> {
  const story = await readStory(slug);
  if (!story.archived) {
    throw new Error('Only archived stories can be permanently deleted — archive it first');
  }

  const jobs = await readJobs();
  const active = jobs.jobs.find((job) => job.storyId === slug && isRunning(job));
  if (active) {
    throw new Error('Cannot delete a story with an active job — stop it first');
  }

  await fs.rm(storyDir(slug), { recursive: true, force: true });

  const index = await readStoryIndex();
  await writeStoryIndex({ stories: index.stories.filter((entry) => entry.id !== slug) });
  await writeJobs({ jobs: jobs.jobs.filter((job) => job.storyId !== slug) });
}

export async function readCharacters(slug: string): Promise<CharactersFile> {
  const story = await readStory(slug);
  return readJsonFile<CharactersFile>(resolveStoryPath(slug, story.text.charactersPath), {
    characters: [],
  });
}

export async function writeCharacters(
  slug: string,
  characters: CharactersFile,
): Promise<CharactersFile> {
  const story = await readStory(slug);
  await writeJsonFile(resolveStoryPath(slug, story.text.charactersPath), characters);
  return characters;
}

export async function readSegments(slug: string): Promise<SegmentsFile> {
  const story = await readStory(slug);
  return readJsonFile<SegmentsFile>(resolveStoryPath(slug, story.text.segmentsPath), {
    segments: [],
  });
}

export async function writeSegments(
  slug: string,
  segments: SegmentsFile,
): Promise<SegmentsFile> {
  const story = await readStory(slug);
  const ordered = {
    segments: [...segments.segments]
      .sort((a, b) => a.order - b.order)
      .map((segment, index) => ({ ...segment, order: index + 1 })),
  };
  await writeJsonFile(resolveStoryPath(slug, story.text.segmentsPath), ordered);
  return ordered;
}

export async function readStoryText(slug: string): Promise<string> {
  const story = await readStory(slug);
  return readTextFile(resolveStoryPath(slug, story.text.storyPath));
}

export async function writeStoryText(slug: string, storyText: string): Promise<void> {
  const story = await readStory(slug);
  await writeTextFile(
    resolveStoryPath(slug, story.text.storyPath),
    normalizeStoryText(storyText),
  );
  // Deliberately does not touch video/plan.json or video/intro.jpg — those are
  // expensive human choices that remain valid across a text edit + re-render.
  await patchStory(slug, (current) => ({
    ...current,
    status: 'story_draft',
    approvals: {
      segments: { status: 'pending', approvedAt: null },
      verifiedAudio: { status: 'pending', approvedAt: null },
      finalAudio: { status: 'pending', approvedAt: null },
      finalVideo: { status: 'pending', approvedAt: null },
      metadata: { status: 'pending', approvedAt: null },
    },
    audio: { ...current.audio, status: 'pending' },
    video: { ...current.video, status: 'pending' },
  }));
}

export async function setApproval(
  slug: string,
  key: 'segments' | 'verifiedAudio' | 'finalAudio' | 'finalVideo' | 'metadata',
  status: ApprovalStatus,
): Promise<StoryRecord> {
  const approvedAt = status === 'approved' ? new Date().toISOString() : null;
  return patchStory(slug, (story) => {
    const next = {
      ...story,
      approvals: {
        ...story.approvals,
        [key]: { status, approvedAt },
      },
    };

    if (key === 'segments' && status === 'approved') {
      next.status = 'segments_approved';
    }

    if (key === 'verifiedAudio' && status === 'approved') {
      next.status = 'ready_to_concat';
    }

    if (key === 'finalAudio' && status === 'approved') {
      next.status = 'audio_complete';
      next.audio = { ...next.audio, status: 'complete' };
    }

    if (key === 'finalVideo' && status === 'approved') {
      next.status = 'video_complete';
    }

    if (key === 'metadata' && status === 'approved') {
      next.status = 'metadata_ready';
    }

    return next;
  });
}

export async function getStoryDetail(slug: string): Promise<StoryDetail> {
  const [story, storyText, characters, segments, jobs, videoPlan, videoRenders, youtubeMetadata] =
    await Promise.all([
      readStory(slug),
      readStoryText(slug),
      readCharacters(slug),
      readSegments(slug),
      readJobs(),
      readVideoPlanOrDefaults(slug),
      listVideoRenders(slug),
      readYoutubeMetadataOrDefault(slug),
    ]);
  const storyJobs = jobs.jobs
    .filter((job) => job.storyId === slug)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // isRunning covers "pending" too: a job waiting in the global TTS queue is
  // just as much this story's active job — the UI has to show it and keep the
  // run buttons disabled, or the user re-clicks and gets a rejected start.
  const activeJob = storyJobs.find((job) => isRunning(job)) ?? null;
  const finalAudioExists = await pathExists(resolveStoryPath(slug, story.audio.finalPath));
  const finalVideoExists = await pathExists(resolveStoryPath(slug, story.video.finalPath));

  return {
    story,
    storyText,
    characters,
    segments,
    activeJob,
    recentJobs: storyJobs.slice(0, 8),
    finalAudioExists,
    videoPlan,
    finalVideoExists,
    videoRenders,
    youtubeMetadata,
    analytics: computeStoryAnalytics(story, storyJobs),
  };
}

export async function listStories(): Promise<StoryIndexEntry[]> {
  const index = await readStoryIndex();
  return index.stories
    // Entries created before the archive/library-import features shipped have no
    // archived/archivedAt/sourceContentId fields on disk.
    .map((entry) => ({
      ...entry,
      archived: entry.archived ?? false,
      archivedAt: entry.archivedAt ?? null,
      sourceContentId: entry.sourceContentId ?? null,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeWorkerResult(
  slug: string,
  resultPath: string,
  result: unknown,
): Promise<void> {
  await writeJsonFile(resolveStoryPath(slug, resultPath), result);
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// resolveStoryPath only guards against escaping the story folder root; the
// asset route is documented as serving only specific top-level subfolders, so
// this also confirms the resolved path is actually inside one of them — a raw
// string check like relativePath.startsWith('audio/') passes for
// "audio/../story.json" (still inside the story root, but no longer inside
// audio/).
export function resolveStoryAsset(
  slug: string,
  relativePath: string,
  allowedDirs: string[] = ['audio'],
): { absolutePath: string; contentType: string } {
  const resolved = resolveStoryPath(slug, relativePath);
  const insideAllowedDir = allowedDirs.some((dir) => {
    const dirRoot = path.join(storyDir(slug), dir);
    return resolved === dirRoot || resolved.startsWith(`${dirRoot}${path.sep}`);
  });
  if (!insideAllowedDir) {
    throw new Error(`Only assets under ${allowedDirs.map((dir) => `${dir}/`).join(' or ')} can be served`);
  }
  const extension = path.extname(resolved).toLowerCase();
  const contentType = ASSET_CONTENT_TYPES[extension] ?? 'application/octet-stream';

  return { absolutePath: resolved, contentType };
}

export function nextSegmentId(segments: SegmentRecord[]): string {
  const maxId = segments.reduce((max, segment) => {
    const parsed = Number.parseInt(segment.id, 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${maxId + 1}`.padStart(4, '0');
}

export async function readVoices(): Promise<VoicesFile> {
  await ensureDataFiles();
  return readJsonFile<VoicesFile>(voicesPath, { voices: [] });
}

export async function addVoice(name: string, wav: Buffer): Promise<VoiceRecord> {
  const voices = await readVoices();
  const baseId = slugify(name);
  let id = baseId;
  let suffix = 2;
  while (voices.voices.some((voice) => voice.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const wavPath = path.join('data', 'voices', `${id}.wav`);
  await atomicWrite(path.join(voicesDir, `${id}.wav`), wav);

  const voice: VoiceRecord = {
    id,
    name: name.trim(),
    wavPath,
    createdAt: new Date().toISOString(),
  };
  await writeJsonFile<VoicesFile>(voicesPath, { voices: [...voices.voices, voice] });
  return voice;
}

export async function deleteVoice(id: string): Promise<void> {
  const voices = await readVoices();
  const voice = voices.voices.find((entry) => entry.id === id);
  if (!voice) {
    return;
  }

  await writeJsonFile<VoicesFile>(voicesPath, {
    voices: voices.voices.filter((entry) => entry.id !== id),
  });

  try {
    await fs.unlink(path.join(voicesDir, `${id}.wav`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const cachedPreviews = await fs.readdir(voicePreviewCacheRoot).catch(() => []);
  await Promise.all(
    cachedPreviews
      .filter((entry) => entry.startsWith(`${id}__`))
      .map((entry) => fs.unlink(path.join(voicePreviewCacheRoot, entry)).catch(() => undefined)),
  );
}

// --- Media catalog (background music, rain ambience, intro music, scene
// video) — a shared registry for the video-assembly stage, following the
// same shape as the voice-cloning registry above but with four categories
// instead of one and a probe step at ingest. See VIDEO_ASSEMBLY_PLAN.md §1.

export async function readMediaLibrary(): Promise<MediaLibraryFile> {
  await ensureDataFiles();
  const library = await readJsonFile<MediaLibraryFile>(mediaManifestPath, { schemaVersion: 1, media: [] });
  return {
    ...library,
    media: library.media.map((asset) =>
      asset.category === 'scene_video' && !asset.gradeOverride
        ? { ...asset, gradeOverride: { brightness: null, vignette: null } }
        : asset,
    ),
  };
}

async function writeMediaLibrary(library: MediaLibraryFile): Promise<void> {
  await writeJsonFile(mediaManifestPath, library);
}

const DEFAULT_GAIN_CONFIG_KEY: Record<'bg_music' | 'rain_ambience' | 'intro_music', 'bgMusic' | 'rainAmbience' | 'introMusic'> = {
  bg_music: 'bgMusic',
  rain_ambience: 'rainAmbience',
  intro_music: 'introMusic',
};

export async function addMediaAsset(input: {
  category: MediaCategory;
  name: string;
  source?: string;
  notes?: string;
  loopable?: boolean;
  extension: string;
  // Exactly one of these: a browser-uploaded buffer, or an absolute path to
  // a file already on this machine — the app runs on the operator's own
  // machine (see 01_SYSTEM_ARCHITECTURE.md's "Localhost only" stance), so a
  // local path is the operator pointing the server at their own disk, not an
  // arbitrary remote client reaching into it. Never wire this file/route up
  // behind anything but localhost.
  file?: Buffer;
  sourcePath?: string;
}): Promise<MediaAsset> {
  const name = input.name.trim();
  const source = input.source?.trim() ?? '';
  if (!name) {
    throw new Error('Media name is required');
  }
  if (input.file && input.file.length === 0) {
    throw new Error('Uploaded file is empty');
  }
  if (!input.file && !input.sourcePath) {
    throw new Error('file or sourcePath is required');
  }

  const library = await readMediaLibrary();
  const baseId = slugify(name);
  let id = baseId;
  let suffix = 2;
  while (library.media.some((asset) => asset.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const extension = input.extension.startsWith('.') ? input.extension : `.${input.extension}`;
  const relativePath = path.join('data', 'media', input.category, `${id}${extension}`);
  const absolutePath = path.join(mediaCategoryDir(input.category), `${id}${extension}`);
  if (input.sourcePath) {
    await copyLocalFile(input.sourcePath, absolutePath);
  } else {
    await atomicWrite(absolutePath, input.file as Buffer);
  }

  // ffprobe (metadata only) is fast regardless of file length, so it runs
  // synchronously here. Loudness measurement decodes the whole file — at
  // ~20-25x realtime that's minutes for a long ambience loop, far too slow
  // to hold this request open for — so it's kicked off in the background
  // below and patched into the manifest once it resolves.
  const probe = await probeMediaMetadata(absolutePath, input.category);
  const addedAt = new Date().toISOString();
  const base = {
    id,
    category: input.category,
    name,
    path: toPosixPath(relativePath),
    loopable: input.loopable ?? true,
    durationMs: probe.durationMs,
    source,
    notes: input.notes?.trim() ?? '',
    addedAt,
  };

  let asset: MediaAsset;
  if (base.category === 'scene_video') {
    asset = {
      ...base,
      category: 'scene_video',
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudioStream: probe.hasAudioStream,
      gradeOverride: { brightness: null, vignette: null },
    } satisfies VideoMediaAsset;
  } else {
    const config = await readVideoAppConfig();
    const gainKey = DEFAULT_GAIN_CONFIG_KEY[base.category];
    asset = {
      ...base,
      category: base.category,
      integratedLufs: null,
      defaultGainDb: config.defaultGainDb[gainKey],
    } satisfies AudioMediaAsset;
  }

  await writeMediaLibrary({ ...library, media: [...library.media, asset] });

  if (asset.category !== 'scene_video') {
    void backfillIntegratedLufs(asset.id, absolutePath);
  }

  return asset;
}

// Lets the operator correct anything the automated ingest got wrong: a
// miscategorized upload, a name typo, or — the common one — a
// loudness-derived defaultGainDb that turns out too loud/quiet once actually
// heard against narration. Moving between the three audio categories is
// allowed (same field shape); moving into/out of scene_video is not, since
// that would require re-probing the file as a fundamentally different kind
// of asset — delete and re-add covers that instead.
export async function updateMediaAsset(
  id: string,
  patch: {
    name?: string;
    category?: MediaCategory;
    source?: string;
    notes?: string;
    loopable?: boolean;
    defaultGainDb?: number;
    gradeOverride?: GradeOverride;
  },
): Promise<MediaAsset> {
  const library = await readMediaLibrary();
  const current = library.media.find((asset) => asset.id === id);
  if (!current) {
    throw new Error(`Unknown media id: ${id}`);
  }

  const nextCategory = patch.category ?? current.category;
  const wasAudio = current.category !== 'scene_video';
  const willBeAudio = nextCategory !== 'scene_video';
  if (wasAudio !== willBeAudio) {
    throw new Error(
      'Cannot move a media asset between an audio category and scene video — delete and re-add it instead',
    );
  }

  let nextPath = current.path;
  if (nextCategory !== current.category) {
    const extension = path.extname(current.path);
    const oldAbsolutePath = path.join(projectRoot, current.path);
    const newRelativePath = path.join('data', 'media', nextCategory, `${id}${extension}`);
    const newAbsolutePath = path.join(mediaCategoryDir(nextCategory), `${id}${extension}`);
    await ensureDir(path.dirname(newAbsolutePath));
    await fs.rename(oldAbsolutePath, newAbsolutePath);
    nextPath = toPosixPath(newRelativePath);
  }

  const name = patch.name?.trim() ? patch.name.trim() : current.name;
  const source = patch.source !== undefined ? patch.source.trim() : current.source;
  const notes = patch.notes !== undefined ? patch.notes.trim() : current.notes;
  const loopable = patch.loopable !== undefined ? patch.loopable : current.loopable;

  let nextAsset: MediaAsset;
  if (current.category === 'scene_video') {
    nextAsset = {
      ...current,
      path: nextPath,
      name,
      source,
      notes,
      loopable,
      gradeOverride: patch.gradeOverride ?? current.gradeOverride,
    };
  } else {
    nextAsset = {
      ...current,
      category: nextCategory as 'bg_music' | 'rain_ambience' | 'intro_music',
      path: nextPath,
      name,
      source,
      notes,
      loopable,
      defaultGainDb: patch.defaultGainDb !== undefined ? patch.defaultGainDb : current.defaultGainDb,
    };
  }

  await writeMediaLibrary({
    ...library,
    media: library.media.map((asset) => (asset.id === id ? nextAsset : asset)),
  });
  return nextAsset;
}

// Fire-and-forget: this process stays alive for the life of the dev/prod
// server, so a background promise here really does finish — nothing awaits
// it and the upload response has already gone out by the time it runs.
// Re-reads the manifest fresh (rather than reusing the caller's stale copy)
// so it doesn't clobber an unrelated asset added or removed in the meantime;
// the asset having been deleted mid-analysis is not an error, just a no-op.
async function backfillIntegratedLufs(id: string, absolutePath: string): Promise<void> {
  try {
    const integratedLufs = await probeIntegratedLufs(absolutePath);
    if (integratedLufs === null) {
      return;
    }
    const library = await readMediaLibrary();
    const target = library.media.find((entry) => entry.id === id);
    if (!target || target.category === 'scene_video') {
      return;
    }
    await writeMediaLibrary({
      ...library,
      media: library.media.map((entry) => (entry.id === id ? { ...entry, integratedLufs } : entry)),
    });
  } catch {
    // Loudness normalization is a nice-to-have consistency feature, not a
    // correctness requirement — render-time gain falls back to the plan's
    // bare gainDb when integratedLufs is null (see compute_gain_db in
    // workers/render_video.py), so a failed backfill is silently dropped.
  }
}

// Which stories' video plans reference this catalog id, restricted to
// non-archived stories — an archived story's plan referencing a deleted asset
// is not this app's problem to flag.
export async function findMediaReferences(id: string): Promise<string[]> {
  const index = await readStoryIndex();
  const referencing: string[] = [];
  for (const entry of index.stories) {
    if (entry.archived) {
      continue;
    }
    const plan = await readVideoPlanRaw(entry.id);
    if (!plan) {
      continue;
    }
    if (
      plan.introMusicId === id ||
      plan.sceneVideoId === id ||
      plan.bgMusicId === id ||
      plan.rainAmbienceId === id
    ) {
      referencing.push(entry.id);
    }
  }
  return referencing;
}

export async function deleteMediaAsset(id: string, force = false): Promise<void> {
  const library = await readMediaLibrary();
  const asset = library.media.find((entry) => entry.id === id);
  if (!asset) {
    return;
  }

  if (!force) {
    const referencedBy = await findMediaReferences(id);
    if (referencedBy.length > 0) {
      const error = new Error(
        `Media "${id}" is referenced by ${referencedBy.length} story video plan(s)`,
      ) as Error & { referencedBy?: string[] };
      error.referencedBy = referencedBy;
      throw error;
    }
  }

  await writeMediaLibrary({ ...library, media: library.media.filter((entry) => entry.id !== id) });

  try {
    await fs.unlink(path.join(projectRoot, asset.path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function resolveMediaAssetFile(asset: MediaAsset): string {
  return path.join(projectRoot, asset.path);
}

// --- Per-story video plan — the operator's reviewable/overridable picks from
// the media catalog, plus the one true per-story input (the intro image).
// See VIDEO_ASSEMBLY_PLAN.md §2.

function videoPlanRelativePath(): string {
  return 'video/plan.json';
}

async function readVideoPlanRaw(slug: string): Promise<VideoPlanFile | null> {
  try {
    return await readJsonFile<VideoPlanFile | null>(
      resolveStoryPath(slug, videoPlanRelativePath()),
      null,
    );
  } catch {
    return null;
  }
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[Math.floor(Math.random() * items.length)];
}

async function buildDefaultVideoPlan(): Promise<VideoPlanFile> {
  const [config, library] = await Promise.all([readVideoAppConfig(), readMediaLibrary()]);
  const byCategory = (category: MediaCategory): MediaAsset[] =>
    library.media.filter((asset) => asset.category === category);

  const sceneVideo = pickRandom(byCategory('scene_video')) as VideoMediaAsset | undefined;
  const introMusic = pickRandom(byCategory('intro_music')) as AudioMediaAsset | undefined;
  const bgMusic = pickRandom(byCategory('bg_music')) as AudioMediaAsset | undefined;
  const rainAmbience = pickRandom(byCategory('rain_ambience')) as AudioMediaAsset | undefined;

  return {
    schemaVersion: 1,
    introImagePath: null,
    introMusicId: introMusic?.id ?? null,
    introDurationMs: config.introDurationMs,
    introMusicGainDb: introMusic?.defaultGainDb ?? config.defaultGainDb.introMusic,
    sceneVideoId: sceneVideo?.id ?? null,
    bgMusicId: bgMusic?.id ?? null,
    bgMusicGainDb: bgMusic?.defaultGainDb ?? config.defaultGainDb.bgMusic,
    rainAmbienceId: rainAmbience?.id ?? null,
    rainAmbienceGainDb: rainAmbience?.defaultGainDb ?? config.defaultGainDb.rainAmbience,
    leadInMs: config.leadInMs,
    tailOutMs: config.tailOutMs,
    transitionMs: config.transitionMs,
    duckingEnabled: true,
    gradeOverride: { brightness: null, vignette: null },
    gainManuallyEdited: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function writeVideoPlan(slug: string, plan: VideoPlanFile): Promise<VideoPlanFile> {
  const next = { ...plan, updatedAt: new Date().toISOString() };
  await writeJsonFile(resolveStoryPath(slug, videoPlanRelativePath()), next);
  return next;
}

// The first time a story's plan is requested with no plan.json on disk, seed
// one by randomly picking a catalog item per category (a category with no
// entries is left null) and persist it, so the pick is stable across reloads
// instead of re-rolling on every read. Manual edits and the explicit
// randomize action are the only things that change it after that.
export async function readVideoPlanOrDefaults(slug: string): Promise<VideoPlanFile> {
  const existing = await readVideoPlanRaw(slug);
  if (existing) {
    // Legacy plans predate gainManuallyEdited/gradeOverride — backfill both
    // so approve-final-audio and grade resolution never see undefined.
    return {
      ...existing,
      gainManuallyEdited: existing.gainManuallyEdited ?? false,
      gradeOverride: existing.gradeOverride ?? { brightness: null, vignette: null },
    };
  }
  const seeded = await buildDefaultVideoPlan();
  return writeVideoPlan(slug, seeded);
}

export async function randomizeVideoPlan(slug: string): Promise<VideoPlanFile> {
  const current = await readVideoPlanOrDefaults(slug);
  const seeded = await buildDefaultVideoPlan();
  return writeVideoPlan(slug, {
    ...seeded,
    // Non-catalog fields (timings, ducking) are the operator's own tuning —
    // randomizing asset picks shouldn't silently reset them.
    introDurationMs: current.introDurationMs,
    leadInMs: current.leadInMs,
    tailOutMs: current.tailOutMs,
    transitionMs: current.transitionMs,
    duckingEnabled: current.duckingEnabled,
    introImagePath: current.introImagePath,
    // A story-level grade tweak is a deliberate creative choice independent
    // of which random scene video gets picked — preserve it like the other
    // operator-tuned fields above.
    gradeOverride: current.gradeOverride,
    // gainManuallyEdited intentionally NOT preserved from `current` — a
    // reroll adopts the newly-picked assets' own defaultGainDb (via
    // `seeded`), so any prior hand-tuning no longer corresponds to what's
    // playing; treat this like a fresh plan and re-open auto-sync.
  });
}

// Called from approve-final-audio: if the operator never hand-tuned this
// story's gain, pull each referenced asset's *current* library defaultGainDb
// in — the one moment a story's stale gain (baked in whenever the plan was
// built/last saved) gets refreshed. A manual edit opts a story out
// permanently until the operator randomizes or resets the flag.
export async function syncVideoPlanGainToLibraryDefaults(slug: string): Promise<VideoPlanFile> {
  const plan = await readVideoPlanOrDefaults(slug);
  if (plan.gainManuallyEdited) {
    return plan;
  }

  const { media } = await readMediaLibrary();
  const byId = new Map(media.map((asset) => [asset.id, asset]));

  const resolveGain = (
    id: string | null,
    category: 'bg_music' | 'rain_ambience' | 'intro_music',
    fallback: number,
  ): number => {
    if (!id) return fallback;
    const asset = byId.get(id);
    return asset && asset.category === category ? (asset as AudioMediaAsset).defaultGainDb : fallback;
  };

  return writeVideoPlan(slug, {
    ...plan,
    bgMusicGainDb: resolveGain(plan.bgMusicId, 'bg_music', plan.bgMusicGainDb),
    rainAmbienceGainDb: resolveGain(plan.rainAmbienceId, 'rain_ambience', plan.rainAmbienceGainDb),
    introMusicGainDb: resolveGain(plan.introMusicId, 'intro_music', plan.introMusicGainDb),
  });
}

// Operator-initiated opt-back-in: clears the manual-edit flag and immediately
// pulls the library's current defaults, without waiting for the next
// approve-final-audio. Used by the "Reset to library defaults" action in the
// Video tab, shown only once a story's gain has been hand-edited.
export async function resetVideoPlanGainToLibraryDefaults(slug: string): Promise<VideoPlanFile> {
  const plan = await readVideoPlanOrDefaults(slug);
  await writeVideoPlan(slug, { ...plan, gainManuallyEdited: false });
  return syncVideoPlanGainToLibraryDefaults(slug);
}

// --- Video render history — render_video.py never overwrites a previous
// render; every job writes its own stories/[slug]/video/renders/<jobId>.mp4
// + <jobId>.render.json. "Current" is just whichever one story.video.finalPath
// happens to point at (freshly rendered ones become current automatically;
// selectVideoRender below lets the operator point it at an older one instead).

function videoRendersDir(slug: string): string {
  return path.join(storyDir(slug), 'video', 'renders');
}

export async function listVideoRenders(slug: string): Promise<VideoRenderSummary[]> {
  const story = await readStory(slug);
  const rendersDir = videoRendersDir(slug);
  const entries = await fs.readdir(rendersDir).catch(() => [] as string[]);
  const jobIds = entries
    .filter((entry) => entry.endsWith('.render.json'))
    .map((entry) => entry.slice(0, -'.render.json'.length));

  const summaries = await Promise.all(
    jobIds.map(async (jobId): Promise<VideoRenderSummary | null> => {
      const receipt = await readJsonFile<VideoRenderReceipt | null>(
        path.join(rendersDir, `${jobId}.render.json`),
        null,
      );
      if (!receipt) {
        return null;
      }
      const isCurrent = story.video.finalPath === receipt.outputPath;
      return {
        jobId,
        path: receipt.outputPath,
        renderedAt: receipt.renderedAt,
        durationMs: receipt.durationMs,
        isCurrent,
        isApproved: isCurrent && story.approvals.finalVideo.status === 'approved',
        plan: receipt.plan,
      };
    }),
  );

  return summaries
    .filter((summary): summary is VideoRenderSummary => summary !== null)
    .sort((a, b) => b.renderedAt.localeCompare(a.renderedAt));
}

// Repoints story.video.finalPath at an older render instead of re-rendering —
// always resets the finalVideo approval, since approving one rendered file
// must never silently carry over to a different one the operator switches to.
export async function selectVideoRender(slug: string, jobId: string): Promise<StoryRecord> {
  const rendersDir = videoRendersDir(slug);
  const receipt = await readJsonFile<VideoRenderReceipt | null>(
    path.join(rendersDir, `${jobId}.render.json`),
    null,
  );
  if (!receipt) {
    throw new Error(`Unknown render: ${jobId}`);
  }
  if (!(await pathExists(resolveStoryPath(slug, receipt.outputPath)))) {
    throw new Error(`Render file is missing on disk: ${receipt.outputPath}`);
  }

  return patchStory(slug, (story) => ({
    ...story,
    video: {
      ...story.video,
      finalPath: receipt.outputPath,
      status: 'complete',
      durationMs: receipt.durationMs,
      renderedAt: receipt.renderedAt,
    },
    approvals: {
      ...story.approvals,
      finalVideo: { status: 'pending', approvedAt: null },
    },
  }));
}

export async function deleteVideoRender(slug: string, jobId: string): Promise<void> {
  const story = await readStory(slug);
  const rendersDir = videoRendersDir(slug);
  const receiptPath = path.join(rendersDir, `${jobId}.render.json`);
  const receipt = await readJsonFile<VideoRenderReceipt | null>(receiptPath, null);
  if (!receipt) {
    return;
  }
  const isCurrent = story.video.finalPath === receipt.outputPath;

  await fs.unlink(resolveStoryPath(slug, receipt.outputPath)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  });
  await fs.unlink(receiptPath).catch(() => undefined);

  if (isCurrent) {
    // Deleting the render the story currently points at (approved or not) —
    // clear the pointer and reset approval, same as switching to a
    // different render via selectVideoRender, so the story never references
    // a final video file that no longer exists.
    await patchStory(slug, (current) => ({
      ...current,
      video: {
        ...current.video,
        finalPath: 'video/final.mp4',
        status: 'pending',
        durationMs: null,
        renderedAt: null,
      },
      approvals: {
        ...current.approvals,
        finalVideo: { status: 'pending', approvedAt: null },
      },
    }));
  }
}

// --- Trash cleanup — once a story's final video is approved AND the
// operator archives it, nothing else generated for this story will ever be
// used again: older video renders (render_video.py never overwrites, so
// they pile up) and segment audio takes that got swapped out via
// select-take. Only called from the archive PATCH route, and only when both
// conditions hold — see that route for the gating.
export async function cleanupStoryTrash(slug: string): Promise<void> {
  const renders = await listVideoRenders(slug);
  await Promise.all(
    renders.filter((render) => !render.isCurrent).map((render) => deleteVideoRender(slug, render.jobId)),
  );

  const { segments } = await readSegments(slug);
  if (!segments.some((segment) => segment.previousTake)) {
    return;
  }
  const cleaned = await Promise.all(
    segments.map(async (segment) => {
      if (!segment.previousTake) {
        return segment;
      }
      await fs.unlink(resolveStoryPath(slug, segment.previousTake.path)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      });
      return { ...segment, previousTake: null };
    }),
  );
  await writeSegments(slug, { segments: cleaned });
}

// --- YouTube upload metadata — a lightweight (non-job) OpenAI structured-
// outputs call, generated once the final video is approved, then edited/
// approved by the operator. See VideoAssembly-adjacent design notes for why
// this is a direct API-route call rather than a job-runner worker: it's one
// short HTTP request, not a GPU/ffmpeg-bound background process.

function youtubeMetadataRelativePath(): string {
  return 'metadata/youtube.json';
}

const DEFAULT_YOUTUBE_METADATA: YoutubeMetadataFile = {
  schemaVersion: 1,
  status: 'pending',
  generatedAt: null,
  model: null,
  sourceSnapshot: null,
  titles: [],
  selectedTitleIndex: 0,
  teaser: '',
  tags: [],
  category: '',
  thumbnailPrompts: [],
  pinnedComment: [],
  selectedPinnedCommentIndex: 0,
  storyHashtag: '',
  renderedDescription: '',
  error: null,
};

// Upgrades on-disk shapes from before pinnedComment became a variant array
// (and before contextHook was dropped) — the stray contextHook key, if
// present, is simply absent from this type and gets dropped on next write.
function normalizeYoutubeMetadata(raw: YoutubeMetadataFile): YoutubeMetadataFile {
  const rawPinnedComment = (raw as unknown as { pinnedComment?: unknown }).pinnedComment;
  const pinnedComment = Array.isArray(rawPinnedComment)
    ? (rawPinnedComment as string[])
    : typeof rawPinnedComment === 'string' && rawPinnedComment
      ? [rawPinnedComment]
      : [];
  return {
    ...raw,
    pinnedComment,
    selectedPinnedCommentIndex: raw.selectedPinnedCommentIndex ?? 0,
  };
}

export async function readYoutubeMetadataOrDefault(slug: string): Promise<YoutubeMetadataFile> {
  const raw = await readJsonFile<YoutubeMetadataFile>(
    resolveStoryPath(slug, youtubeMetadataRelativePath()),
    DEFAULT_YOUTUBE_METADATA,
  );
  return normalizeYoutubeMetadata(raw);
}

async function writeYoutubeMetadataFile(
  slug: string,
  data: YoutubeMetadataFile,
): Promise<YoutubeMetadataFile> {
  await writeJsonFile(resolveStoryPath(slug, youtubeMetadataRelativePath()), data);
  return data;
}

async function rerenderDescription(
  slug: string,
  fields: { titles: string[]; selectedTitleIndex: number; teaser: string },
): Promise<{ storyHashtag: string; renderedDescription: string }> {
  const story = await readStory(slug);
  const storyHashtag = slugifyForHashtag(story.title);
  const selectedTitle = fields.titles[fields.selectedTitleIndex] ?? fields.titles[0] ?? story.title;
  const renderedDescription = await renderYoutubeDescription({
    title: selectedTitle,
    teaser: fields.teaser,
    storyHashtag,
  });
  return { storyHashtag, renderedDescription };
}

// Calls out to OpenAI for the story-specific fields (titles, teaser, tags,
// thumbnail prompts, pinned comment). When `fieldGroups` is omitted/empty,
// regenerates everything (a full first-generation or an explicit "generate
// all" from the operator); otherwise only the requested groups are
// regenerated and merged into the existing file, leaving every other field
// untouched. A failed OpenAI call is recorded on the metadata file (status
// 'failed' + error) rather than left silently unresolved, so the UI can show
// why generation didn't produce anything.
export async function generateYoutubeMetadata(
  slug: string,
  fieldGroups?: YoutubeMetadataFieldGroup[],
): Promise<YoutubeMetadataFile> {
  const requested = (fieldGroups ?? []).filter((group) => ALL_YOUTUBE_METADATA_FIELD_GROUPS.includes(group));
  const groups = requested.length > 0 ? requested : ALL_YOUTUBE_METADATA_FIELD_GROUPS;

  const [story, storyText] = await Promise.all([readStory(slug), readStoryText(slug)]);
  const current = await readYoutubeMetadataOrDefault(slug);

  let fields;
  try {
    fields = await generateYoutubeMetadataFields({
      title: story.title,
      storyText,
      videoDurationMs: story.video.durationMs,
      fieldGroups: groups,
    });
  } catch (error) {
    const failed: YoutubeMetadataFile = {
      ...current,
      status: 'failed',
      error: error instanceof Error ? error.message : 'OpenAI request failed',
    };
    await writeYoutubeMetadataFile(slug, failed);
    await patchStory(slug, (currentStory) => ({
      ...currentStory,
      metadata: { ...currentStory.metadata, status: 'failed' },
    }));
    throw error;
  }

  const storyTextHash = crypto.createHash('sha256').update(storyText).digest('hex');

  const merged: YoutubeMetadataFile = { ...current };
  if (fields.titles) {
    merged.titles = fields.titles;
    merged.selectedTitleIndex = 0;
  }
  if (fields.teaser !== undefined) merged.teaser = fields.teaser;
  if (fields.tags) merged.tags = fields.tags;
  if (fields.category !== undefined) merged.category = fields.category;
  // The highlight sentence is composed from the live selected title at copy
  // time, so only the prompt body is persisted — drop the line if the model
  // wrote one anyway.
  if (fields.thumbnailPrompts) merged.thumbnailPrompts = fields.thumbnailPrompts.map(stripHighlightText);
  if (fields.pinnedComment) {
    merged.pinnedComment = fields.pinnedComment;
    merged.selectedPinnedCommentIndex = 0;
  }
  merged.schemaVersion = 1;
  merged.model = fields.model;
  merged.status = 'generated';
  merged.generatedAt = new Date().toISOString();
  merged.error = null;
  merged.sourceSnapshot = {
    storyTitle: story.title,
    videoDurationMs: story.video.durationMs,
    storyTextHash,
  };

  const { storyHashtag, renderedDescription } = await rerenderDescription(slug, {
    titles: merged.titles,
    selectedTitleIndex: merged.selectedTitleIndex,
    teaser: merged.teaser,
  });
  merged.storyHashtag = storyHashtag;
  merged.renderedDescription = renderedDescription;

  await writeYoutubeMetadataFile(slug, merged);
  // A fresh generation — full or partial — always needs a fresh look before
  // shipping: reset any approval left over from a previous generation/edit
  // round.
  await patchStory(slug, (currentStory) => ({
    ...currentStory,
    metadata: { ...currentStory.metadata, status: 'generated' },
    approvals: { ...currentStory.approvals, metadata: { status: 'pending', approvedAt: null } },
  }));

  return merged;
}

// Operator edits after generation (swap which title/pinned-comment variant is
// primary, tweak the teaser, fix a tag). Recomputes the rendered description
// any time a field that feeds the template changes, and — like a
// generation — invalidates any existing approval, since the approved text is
// no longer what's on disk.
export async function updateYoutubeMetadata(
  slug: string,
  patch: Partial<
    Pick<
      YoutubeMetadataFile,
      | 'titles'
      | 'selectedTitleIndex'
      | 'teaser'
      | 'tags'
      | 'category'
      | 'thumbnailPrompts'
      | 'pinnedComment'
      | 'selectedPinnedCommentIndex'
    >
  >,
): Promise<YoutubeMetadataFile> {
  const current = await readYoutubeMetadataOrDefault(slug);
  const merged = { ...current, ...patch };
  if (patch.thumbnailPrompts) {
    merged.thumbnailPrompts = patch.thumbnailPrompts.map(stripHighlightText);
  }
  const { storyHashtag, renderedDescription } = await rerenderDescription(slug, {
    titles: merged.titles,
    selectedTitleIndex: merged.selectedTitleIndex,
    teaser: merged.teaser,
  });
  const next: YoutubeMetadataFile = { ...merged, storyHashtag, renderedDescription };

  await writeYoutubeMetadataFile(slug, next);
  await patchStory(slug, (currentStory) => ({
    ...currentStory,
    approvals: { ...currentStory.approvals, metadata: { status: 'pending', approvedAt: null } },
  }));

  return next;
}

export function isRunning(job: JobRecord): boolean {
  return job.status === 'running' || job.status === 'pending';
}

// Exit code a worker returns after a cooperative stop (see
// STOPPED_EXIT_CODE in workers/common.py) — distinguishes a user-requested
// stop from a crash so the job shows "cancelled" instead of "failed".
const CANCELLED_EXIT_CODE = 75;

// Matches NEEDS_REVIEW_EXIT_CODE in workers/common.py — a run that finished
// without crashing but left some segments unresolved. Kept distinct from the
// exit code 1 an uncaught exception produces, so a partial success doesn't
// look identical to a crash.
const NEEDS_REVIEW_EXIT_CODE = 2;

export function jobStatusFromExitCode(code: number | null): JobStatus {
  if (code === 0) {
    return 'complete';
  }
  if (code === CANCELLED_EXIT_CODE) {
    return 'cancelled';
  }
  if (code === NEEDS_REVIEW_EXIT_CODE) {
    return 'needs_review';
  }
  return 'failed';
}
