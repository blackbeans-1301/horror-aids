import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  dataRoot,
  resolveStoryPath,
  slugify,
  storiesRoot,
  storyDir,
  voicePreviewCacheRoot,
} from '@/lib/paths';
import type {
  ApprovalStatus,
  CharactersFile,
  JobRecord,
  JobsFile,
  JobStatus,
  JobType,
  JobTypeAnalytics,
  SegmentRecord,
  SegmentsFile,
  SourceType,
  StoryAnalytics,
  StoryDetail,
  StoryIndex,
  StoryIndexEntry,
  StoryRecord,
  VoiceRecord,
  VoicesFile,
} from '@/types/story';

const JOB_TYPES: JobType[] = ['process_story', 'generate_verify_tts', 'concat_audio'];

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
  await fs.rename(tmpPath, filePath);
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

async function reconcileStaleJobs(jobs: JobsFile): Promise<JobsFile> {
  const stale = jobs.jobs.filter(
    (job) => job.status === 'running' && job.pid != null && !isProcessAlive(job.pid),
  );
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

export async function updateJob(
  jobId: string,
  patch: Partial<Pick<JobRecord, 'status' | 'pid' | 'finishedAt' | 'error'>>,
): Promise<void> {
  const jobs = await readJobs();
  const updatedJobs = jobs.jobs.map((job) =>
    job.id === jobId ? { ...job, ...patch } : job,
  );
  await writeJobs({ jobs: updatedJobs });
}

export async function createStory(input: {
  title: string;
  sourceType?: SourceType;
  storyText?: string;
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
    text: {
      storyPath: 'text/story.md',
      charactersPath: 'text/characters.json',
      segmentsPath: 'text/segments.json',
    },
    approvals: {
      segments: { status: 'pending', approvedAt: null },
      verifiedAudio: { status: 'pending', approvedAt: null },
      finalAudio: { status: 'pending', approvedAt: null },
    },
    audio: {
      segmentsDir: 'audio/segments',
      finalPath: 'audio/final.wav',
      status: 'pending',
    },
  };

  await writeJsonFile(resolveStoryPath(slug, 'story.json'), story);
  await writeTextFile(resolveStoryPath(slug, story.text.storyPath), input.storyText ?? '');
  await writeJsonFile<CharactersFile>(resolveStoryPath(slug, story.text.charactersPath), {
    characters: [
      {
        id: 'narrator',
        name: 'Narrator',
        role: 'narrator',
        voice: '',
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
  };
  await writeStoryIndex({ stories: [entry, ...index.stories] });

  return story;
}

export async function readStory(slug: string): Promise<StoryRecord> {
  const story = await readJsonFile<StoryRecord | null>(resolveStoryPath(slug, 'story.json'), null);
  if (!story) {
    throw new Error(`Story not found: ${slug}`);
  }
  // Stories created before the archive feature shipped have no archived/archivedAt fields on disk.
  return { ...story, archived: story.archived ?? false, archivedAt: story.archivedAt ?? null };
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
  await writeTextFile(resolveStoryPath(slug, story.text.storyPath), storyText);
  await patchStory(slug, (current) => ({
    ...current,
    status: 'story_draft',
    approvals: {
      segments: { status: 'pending', approvedAt: null },
      verifiedAudio: { status: 'pending', approvedAt: null },
      finalAudio: { status: 'pending', approvedAt: null },
    },
    audio: { ...current.audio, status: 'pending' },
  }));
}

export async function setApproval(
  slug: string,
  key: 'segments' | 'verifiedAudio' | 'finalAudio',
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

    return next;
  });
}

export async function getStoryDetail(slug: string): Promise<StoryDetail> {
  const [story, storyText, characters, segments, jobs] = await Promise.all([
    readStory(slug),
    readStoryText(slug),
    readCharacters(slug),
    readSegments(slug),
    readJobs(),
  ]);
  const storyJobs = jobs.jobs
    .filter((job) => job.storyId === slug)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const activeJob = storyJobs.find((job) => job.status === 'running') ?? null;
  const finalAudioExists = await pathExists(resolveStoryPath(slug, story.audio.finalPath));

  return {
    story,
    storyText,
    characters,
    segments,
    activeJob,
    recentJobs: storyJobs.slice(0, 8),
    finalAudioExists,
    analytics: computeStoryAnalytics(story, storyJobs),
  };
}

export async function listStories(): Promise<StoryIndexEntry[]> {
  const index = await readStoryIndex();
  return index.stories
    // Entries created before the archive feature shipped have no archived/archivedAt fields on disk.
    .map((entry) => ({ ...entry, archived: entry.archived ?? false, archivedAt: entry.archivedAt ?? null }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeWorkerResult(
  slug: string,
  resultPath: string,
  result: unknown,
): Promise<void> {
  await writeJsonFile(resolveStoryPath(slug, resultPath), result);
}

export async function getAsset(slug: string, relativePath: string): Promise<{
  data: Buffer;
  contentType: string;
}> {
  const resolved = resolveStoryPath(slug, relativePath);
  // resolveStoryPath only guards against escaping the story folder root; this
  // route is documented as audio-only, so also confirm the resolved path is
  // actually inside audio/ — a raw string check like relativePath.startsWith
  // ('audio/') passes for "audio/../story.json" (still inside the story
  // root, but no longer inside audio/).
  const audioRoot = path.join(storyDir(slug), 'audio');
  if (resolved !== audioRoot && !resolved.startsWith(`${audioRoot}${path.sep}`)) {
    throw new Error('Only audio assets can be served');
  }
  const data = await fs.readFile(resolved);
  const extension = path.extname(resolved).toLowerCase();
  const contentType = extension === '.wav' ? 'audio/wav' : 'application/octet-stream';

  return { data, contentType };
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
