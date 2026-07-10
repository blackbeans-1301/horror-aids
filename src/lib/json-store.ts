import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  dataRoot,
  resolveStoryPath,
  slugify,
  storiesRoot,
  storyDir,
} from '@/lib/paths';
import type {
  ApprovalStatus,
  CharactersFile,
  JobRecord,
  JobsFile,
  JobStatus,
  SegmentRecord,
  SegmentsFile,
  SourceType,
  StoryDetail,
  StoryIndex,
  StoryIndexEntry,
  StoryRecord,
  VoiceRecord,
  VoicesFile,
} from '@/types/story';

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

export async function readJobs(): Promise<JobsFile> {
  await ensureDataFiles();
  return readJsonFile<JobsFile>(jobsPath, { jobs: [] });
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
  const story = await readJsonFile<StoryRecord>(
    resolveStoryPath(slug, 'story.json'),
    null as unknown as StoryRecord,
  );
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
}

export function isRunning(job: JobRecord): boolean {
  return job.status === 'running' || job.status === 'pending';
}

export function jobStatusFromExitCode(code: number | null): JobStatus {
  return code === 0 ? 'complete' : 'failed';
}
