import 'server-only';

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { configRoot, pythonExecutable, resolveStoryPath, workersRoot } from '@/lib/paths';
import {
  isRunning,
  jobStatusFromExitCode,
  patchStory,
  readCharacters,
  readJobs,
  readMediaLibrary,
  readSegments,
  readStory,
  readVideoPlanOrDefaults,
  resolveMediaAssetFile,
  updateJob,
  withJobsLock,
  writeJobs,
} from '@/lib/json-store';
import type { JobRecord, JobType, MediaCategory } from '@/types/story';

const workerScripts: Record<JobType, string> = {
  process_story: 'process_story.py',
  generate_verify_tts: 'generate_verify_tts.py',
  concat_audio: 'concat_audio.py',
  render_video: 'render_video.py',
};

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

// TTS is the one job type that saturates the machine: every segment shells out
// to omnivoice-tts, which loads the GGUF model and takes the GPU. Two stories
// generating at once don't finish any sooner — they just halve each other's
// throughput and double peak memory. So TTS jobs queue globally (across all
// stories) instead of starting on demand; process_story and concat_audio are
// cheap and still start immediately. render_video gets its own independent
// cap — x264 is CPU-bound, not GPU-bound, so it can genuinely run alongside a
// TTS job without halving either one.
const MAX_CONCURRENT_BY_TYPE: Partial<Record<JobType, number>> = {
  generate_verify_tts: Math.max(
    1,
    Number.parseInt(process.env.HORROR_AIDS_MAX_TTS_JOBS ?? '', 10) || 1,
  ),
  render_video: Math.max(
    1,
    Number.parseInt(process.env.HORROR_AIDS_MAX_RENDER_JOBS ?? '', 10) || 1,
  ),
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
  // Set when re-checking a job that is already queued: that job is itself
  // "active" for this story, so it must not block its own launch.
  ignoreJobId?: string,
): Promise<void> {
  const jobs = await readJobs();
  const active = jobs.jobs.find(
    (job) => job.storyId === storyId && job.id !== ignoreJobId && isRunning(job),
  );

  if (active) {
    throw new Error(`Story already has active job ${active.id}`);
  }

  const story = await readStory(storyId);

  if (story.archived) {
    throw new Error('Story is archived; unarchive it before starting a job');
  }

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

  if (type === 'render_video') {
    // The audio must be final and approved — rendering many minutes of video
    // around narration the operator hasn't signed off on is pure waste, same
    // gate concat_audio puts on verifiedAudio.
    if (story.approvals.finalAudio.status !== 'approved') {
      throw new Error('Final audio must be approved before rendering video');
    }
    if (!(await fileExists(resolveStoryPath(storyId, story.audio.finalPath)))) {
      throw new Error('Final audio file is missing; re-run concat before rendering video');
    }

    const plan = await readVideoPlanOrDefaults(storyId);
    if (!plan.introImagePath) {
      throw new Error('Upload an intro image before rendering video');
    }
    if (!(await fileExists(resolveStoryPath(storyId, plan.introImagePath)))) {
      throw new Error(`Intro image is missing: ${plan.introImagePath}`);
    }

    // Every referenced catalog id must resolve, in the right category, to a
    // file that exists. null is a valid "omit this layer"; a dangling id is a
    // broken choice and never renders — see VIDEO_ASSEMBLY_PLAN.md §5.
    const { media } = await readMediaLibrary();
    const byId = new Map(media.map((asset) => [asset.id, asset]));
    const roles: Array<{
      field: string;
      id: string | null;
      category: MediaCategory;
      required: boolean;
    }> = [
      { field: 'sceneVideoId', id: plan.sceneVideoId, category: 'scene_video', required: true },
      { field: 'introMusicId', id: plan.introMusicId, category: 'intro_music', required: false },
      { field: 'bgMusicId', id: plan.bgMusicId, category: 'bg_music', required: false },
      { field: 'rainAmbienceId', id: plan.rainAmbienceId, category: 'rain_ambience', required: false },
    ];

    for (const role of roles) {
      if (!role.id) {
        if (role.required) {
          throw new Error(`Video plan needs a ${role.category.replace('_', ' ')} before rendering`);
        }
        continue;
      }
      const asset = byId.get(role.id);
      if (!asset) {
        throw new Error(
          `Video plan references media "${role.id}" (${role.field}) which is no longer in the ` +
            'library; pick a replacement in the Video tab',
        );
      }
      if (asset.category !== role.category) {
        throw new Error(`Media "${role.id}" is a ${asset.category}, not a ${role.category}`);
      }
      if (!(await fileExists(resolveMediaAssetFile(asset)))) {
        throw new Error(`Media file for "${role.id}" is missing on disk: ${asset.path}`);
      }
    }

    if (plan.introDurationMs < 3000 || plan.introDurationMs > 30000) {
      throw new Error('Intro duration must be between 3s and 30s');
    }
    if (plan.leadInMs < 0 || plan.leadInMs > 10000) {
      throw new Error('Lead-in must be between 0 and 10s');
    }
    if (plan.tailOutMs < 0 || plan.tailOutMs > 30000) {
      throw new Error('Tail-out must be between 0 and 30s');
    }
  }
}

// The queue's own arguments live in the command array (that's what actually
// gets executed), so re-validating a job at launch time reads them back out
// instead of duplicating them in the record.
function segmentIdsFromCommand(command: string[]): string[] | undefined {
  const flagIndex = command.indexOf('--segments');
  if (flagIndex === -1) {
    return undefined;
  }
  return command[flagIndex + 1]?.split(',').filter(Boolean);
}

async function launchJob(job: JobRecord): Promise<JobRecord> {
  // Re-validate at launch, not just at enqueue: a job can sit in the queue for
  // hours, and in the meantime the user may have edited segments (which resets
  // the approval), removed a character's voice, or archived the story. Starting
  // a worker that is guaranteed to raise would just burn a slot.
  try {
    await assertCanStartJob(
      job.storyId,
      job.type,
      segmentIdsFromCommand(job.command),
      job.id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Job is no longer startable';
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `Queued job could not start: ${message}`,
    });
    return { ...job, status: 'failed', error: message };
  }

  await patchStory(job.storyId, (story) => {
    if (job.type === 'process_story') {
      return { ...story, status: 'processed' };
    }
    if (job.type === 'generate_verify_tts') {
      return { ...story, status: 'tts_running', audio: { ...story.audio, status: 'running' } };
    }
    if (job.type === 'render_video') {
      // Deliberately does not move story.status (stays audio_complete) — same
      // precedent as concat_audio, which has no "concat_running" status
      // either. The ActiveJobBanner already communicates in-flight work.
      return { ...story, video: { ...story.video, status: 'running' } };
    }
    return story;
  });

  const child = spawn(job.command[0], job.command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
    detached: false,
  });

  await updateJob(job.id, { pid: child.pid ?? null });

  child.on('exit', (code, signal) => {
    void (async (): Promise<void> => {
      // A signal (from stopStoryJob, or an OS-level kill) always means the
      // job was interrupted rather than failing on its own — even for
      // workers like process_story/concat_audio that don't opt into a
      // graceful STOPPED_EXIT_CODE shutdown.
      const status = signal ? 'cancelled' : jobStatusFromExitCode(code);
      await updateJob(job.id, {
        status,
        finishedAt: new Date().toISOString(),
        error: status === 'failed' ? `Worker exited with code ${code ?? 'unknown'}` : null,
      });
      // A slot just freed up — hand it to whatever is waiting.
      void pumpQueue();
    })();
  });

  child.on('error', (error) => {
    void (async (): Promise<void> => {
      await updateJob(job.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
      void pumpQueue();
    })();
  });

  return { ...job, pid: child.pid ?? null };
}

let pumping = false;
let pumpRequested = false;

/**
 * Start as many queued jobs as the concurrency limit allows.
 *
 * Safe (and cheap) to call at any time: with an empty queue it is a single
 * jobs.json read. Call it after enqueueing, after a job exits, and from the
 * read paths the UI polls — that last one is what resumes a queue left behind
 * by an app-server restart, since the in-memory child handles die with it.
 */
export async function pumpQueue(): Promise<void> {
  if (pumping) {
    // Coalesce: a pump already in flight will do another lap for this caller
    // rather than running two claim loops against the same free slot.
    pumpRequested = true;
    return;
  }
  pumping = true;
  try {
    do {
      pumpRequested = false;
      for (;;) {
        // Claiming (pick a pending job, flip it to running) happens under the
        // jobs lock so two pumps can't hand the same slot to two jobs; the
        // spawn itself deliberately happens outside it.
        const claimed = await withJobsLock(async (): Promise<JobRecord | null> => {
          const { jobs } = await readJobs();
          const runningCountByType = new Map<JobType, number>();
          for (const job of jobs) {
            if (job.status === 'running') {
              runningCountByType.set(job.type, (runningCountByType.get(job.type) ?? 0) + 1);
            }
          }
          // New jobs are prepended, so the oldest queued one is last.
          const queued = jobs.filter((job) => job.status === 'pending').reverse();
          const next = queued.find((job) => {
            const cap = MAX_CONCURRENT_BY_TYPE[job.type];
            return cap === undefined || (runningCountByType.get(job.type) ?? 0) < cap;
          });
          if (!next) {
            return null;
          }

          // startedAt is stamped here rather than at enqueue so it measures the
          // run, not the wait — analytics divides by it.
          const started: JobRecord = {
            ...next,
            status: 'running',
            startedAt: new Date().toISOString(),
          };
          await writeJobs({
            jobs: jobs.map((job) => (job.id === started.id ? started : job)),
          });
          return started;
        });

        if (!claimed) {
          break;
        }
        await launchJob(claimed);
      }
    } while (pumpRequested);
  } finally {
    pumping = false;
  }
}

export async function startStoryJob(
  storyId: string,
  type: JobType,
  options?: { segmentIds?: string[] },
): Promise<JobRecord> {
  const segmentIds = type === 'generate_verify_tts' ? options?.segmentIds : undefined;

  // Check-then-commit runs under the jobs lock so two near-simultaneous
  // requests for the same story (double-click, client retry) can't both pass
  // the "no active job" check before either commits.
  const job = await withJobsLock(async (): Promise<JobRecord> => {
    await assertCanStartJob(storyId, type, segmentIds);

    const jobId = createJobId();
    const scriptPath = path.join(workersRoot, workerScripts[type]);
    const command = [
      pythonExecutable(),
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

    const queued: JobRecord = {
      id: jobId,
      storyId,
      type,
      // Every job enters the queue as "pending"; pumpQueue decides when it
      // actually runs. For everything but TTS that is immediately.
      status: 'pending',
      pid: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logPath: `stories/${storyId}/logs/${jobId}.log`,
      resultPath: `stories/${storyId}/tmp/${jobId}.result.json`,
      command,
      error: null,
    };

    const jobs = await readJobs();
    await writeJobs({ jobs: [queued, ...jobs.jobs] });
    return queued;
  });

  await pumpQueue();

  // Report back what the job actually became — started, or still waiting.
  const { jobs } = await readJobs();
  return jobs.find((candidate) => candidate.id === job.id) ?? job;
}

export async function stopStoryJob(storyId: string): Promise<JobRecord> {
  const jobs = await readJobs();
  const active = jobs.jobs.find((job) => job.storyId === storyId && isRunning(job));
  if (!active) {
    throw new Error('No active job to stop');
  }

  // A job still waiting in the queue has no process to signal — dropping it
  // from the queue is the whole of "stopping" it.
  if (active.status === 'pending') {
    await updateJob(active.id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    return { ...active, status: 'cancelled' };
  }

  if (active.pid == null) {
    throw new Error('Job has no process id yet; try again in a moment');
  }

  try {
    process.kill(active.pid, 'SIGTERM');
  } catch (error) {
    // ESRCH means the process already exited; the job's own exit handler
    // will have recorded its final status.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }

  return active;
}

export async function readJobLog(storyId: string, logPathFromJob: string): Promise<string> {
  const relativePath = logPathFromJob.replace(/^stories\/[^/]+\//, '');
  const logPath = resolveStoryPath(storyId, relativePath);

  try {
    return await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
