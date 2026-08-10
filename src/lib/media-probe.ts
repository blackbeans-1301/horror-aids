import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { MediaCategory } from '@/types/story';

const execFileAsync = promisify(execFile);

export interface MediaProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudioStream: boolean;
}

const EMPTY_PROBE: MediaProbeResult = {
  durationMs: null,
  width: null,
  height: null,
  fps: null,
  hasAudioStream: false,
};

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) {
    return null;
  }
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

// ffprobe only reads container/stream metadata, not the media itself — this
// is fast (milliseconds) regardless of file length, so it's safe to run
// synchronously in the upload request. Adding a catalog asset must never
// require a working ffmpeg toolchain — rendering already does, and will fail
// there with a clear message if a probe-derived value turns out to matter. A
// probe failure here is silently accepted with null metadata (see
// VIDEO_ASSEMBLY_PLAN.md §5).
export async function probeMediaMetadata(
  absolutePath: string,
  category: MediaCategory,
): Promise<MediaProbeResult> {
  let ffprobeOutput: FfprobeOutput | null = null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      absolutePath,
    ]);
    ffprobeOutput = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return EMPTY_PROBE;
  }

  const durationSeconds = Number.parseFloat(ffprobeOutput.format?.duration ?? '');
  const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
  const videoStream = ffprobeOutput.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = ffprobeOutput.streams?.find((stream) => stream.codec_type === 'audio');

  return {
    durationMs,
    width: category === 'scene_video' ? videoStream?.width ?? null : null,
    height: category === 'scene_video' ? videoStream?.height ?? null : null,
    fps: category === 'scene_video' ? parseFrameRate(videoStream?.r_frame_rate) : null,
    hasAudioStream: category === 'scene_video' ? Boolean(audioStream) : false,
  };
}

// Measuring integrated loudness means ffmpeg decodes the entire file — at
// roughly 20-25x realtime on this kind of machine, a 5 minute track takes
// ~12s and a 45 minute ambience loop takes several minutes. That's much too
// slow to hold an upload request open for, so callers run this in the
// background (see addMediaAsset in json-store.ts) and patch the result in
// once it resolves, rather than awaiting it before responding.
export async function probeIntegratedLufs(absolutePath: string): Promise<number | null> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-nostdin',
      '-i',
      absolutePath,
      '-af',
      'loudnorm=print_format=json',
      '-f',
      'null',
      '-',
    ]);
    const jsonStart = stderr.lastIndexOf('{');
    const jsonEnd = stderr.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return null;
    }
    const parsed = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1)) as { input_i?: string };
    const value = Number.parseFloat(parsed.input_i ?? '');
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
