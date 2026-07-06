import 'server-only';

import { spawn } from 'node:child_process';
import path from 'node:path';

import { configRoot, resolveStoryPath, workersRoot } from '@/lib/paths';
import {
  isRunning,
  jobStatusFromExitCode,
  patchStory,
  readCharacters,
  readJobs,
  readSegments,
  readStory,
  updateJob,
  writeJobs,
} from '@/lib/json-store';
import type { JobRecord, JobType } from '@/types/story';

const workerScripts: Record<JobType, string> = {
  process_story: 'process_story.py',
  generate_verify_tts: 'generate_verify_tts.py',
  concat_audio: 'concat_audio.py',
};

function createJobId(): string {
  const date = new Date();
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '_');
  return `job_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

async function assertCanStartJob(
  storyId: string,
  type: JobType,
  segmentIds?: string[],
): Promise<void> {
  const jobs = await readJobs();
  const active = jobs.jobs.find((job) => job.storyId === storyId && isRunning(job));

  if (active) {
    throw new Error(`Story already has active job ${active.id}`);
  }

  const story = await readStory(storyId);

  if (type === 'generate_verify_tts') {
    const [charactersFile, segments] = await Promise.all([
      readCharacters(storyId),
      readSegments(storyId),
    ]);
    if (segments.segments.length === 0) {
      throw new Error('No segments available for TTS');
    }

    if (story.approvals.segments.status !== 'approved') {
      throw new Error('Segments must be approved before TTS');
    }

    if (segmentIds?.length) {
      const knownIds = new Set(segments.segments.map((segment) => segment.id));
      const missing = segmentIds.filter((id) => !knownIds.has(id));
      if (missing.length > 0) {
        throw new Error(`Unknown segment ids: ${missing.join(', ')}`);
      }
    }

    const targeted = segmentIds?.length ? new Set(segmentIds) : null;
    const characters = new Map(
      charactersFile.characters.map((character) => [character.id, character]),
    );
    for (const segment of segments.segments) {
      if (segment.status === 'skipped') {
        continue;
      }
      if (targeted && !targeted.has(segment.id)) {
        continue;
      }

      const character = characters.get(segment.speakerId);
      if (!character?.voice.trim()) {
        throw new Error(`Speaker ${segment.speakerId} needs a voice before TTS`);
      }
    }
  }

  if (type === 'concat_audio') {
    if (story.approvals.verifiedAudio.status !== 'approved') {
      throw new Error('Verified audio must be confirmed before concat');
    }

    const segments = await readSegments(storyId);
    const unverified = segments.segments.find(
      (segment) =>
        segment.status !== 'skipped' && segment.verification.status !== 'passed',
    );
    if (unverified) {
      throw new Error(`Segment ${unverified.id} is not verified`);
    }
  }
}

export async function startStoryJob(
  storyId: string,
  type: JobType,
  options?: { segmentIds?: string[] },
): Promise<JobRecord> {
  const segmentIds = type === 'generate_verify_tts' ? options?.segmentIds : undefined;
  await assertCanStartJob(storyId, type, segmentIds);

  const jobId = createJobId();
  const logPath = `logs/${jobId}.log`;
  const resultPath = `tmp/${jobId}.result.json`;
  const scriptPath = path.join(workersRoot, workerScripts[type]);
  const command = [
    'python3',
    scriptPath,
    '--story',
    path.join('stories', storyId),
    '--job-id',
    jobId,
    '--config',
    path.join(configRoot, 'app.json'),
  ];
  if (segmentIds?.length) {
    command.push('--segments', segmentIds.join(','));
  }
  const now = new Date().toISOString();

  const job: JobRecord = {
    id: jobId,
    storyId,
    type,
    status: 'running',
    pid: null,
    startedAt: now,
    finishedAt: null,
    logPath: `stories/${storyId}/${logPath}`,
    resultPath: `stories/${storyId}/${resultPath}`,
    command,
    error: null,
  };

  const jobs = await readJobs();
  await writeJobs({ jobs: [job, ...jobs.jobs] });

  await patchStory(storyId, (story) => {
    if (type === 'process_story') {
      return { ...story, status: 'processed' };
    }
    if (type === 'generate_verify_tts') {
      return { ...story, status: 'tts_running', audio: { ...story.audio, status: 'running' } };
    }
    return story;
  });

  const child = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
    detached: false,
  });

  await updateJob(jobId, { pid: child.pid ?? null });

  child.on('exit', (code) => {
    void (async (): Promise<void> => {
      const status = jobStatusFromExitCode(code);
      await updateJob(jobId, {
        status,
        finishedAt: new Date().toISOString(),
        error: status === 'failed' ? `Worker exited with code ${code ?? 'unknown'}` : null,
      });
    })();
  });

  child.on('error', (error) => {
    void updateJob(jobId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
  });

  return { ...job, pid: child.pid ?? null };
}

export async function readJobLog(storyId: string, logPathFromJob: string): Promise<string> {
  const relativePath = logPathFromJob.replace(/^stories\/[^/]+\//, '');
  const logPath = resolveStoryPath(storyId, relativePath);
  const fs = await import('node:fs/promises');

  try {
    return await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
