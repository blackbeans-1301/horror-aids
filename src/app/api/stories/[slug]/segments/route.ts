import { NextResponse } from 'next/server';

import { patchStory, readSegments, writeSegments } from '@/lib/json-store';
import type { SegmentAudioTake, SegmentVerification } from '@/types/story';
import type {
  SegmentEmotion,
  SegmentRecord,
  SegmentStatus,
  VerificationStatus,
} from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface SegmentsPayload {
  segments?: unknown;
}

const segmentStatuses = new Set<SegmentStatus>([
  'pending',
  'ready',
  'generating',
  'complete',
  'verification_failed',
  'failed',
  'skipped',
]);
const verificationStatuses = new Set<VerificationStatus>([
  'pending',
  'transcribing',
  'passed',
  'failed',
  'max_attempts_reached',
]);

function normalizeVerification(input: unknown): SegmentVerification {
  const verification =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const status = verificationStatuses.has(verification.status as VerificationStatus)
    ? (verification.status as VerificationStatus)
    : 'pending';
  return {
    status,
    attempts: typeof verification.attempts === 'number' ? verification.attempts : 0,
    lastError: typeof verification.lastError === 'string' ? verification.lastError : null,
    transcriptPreview:
      typeof verification.transcriptPreview === 'string' ? verification.transcriptPreview : null,
  };
}

function normalizePreviousTake(input: unknown): SegmentAudioTake | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.path !== 'string' || !record.path.trim()) {
    return null;
  }
  return {
    path: record.path,
    take: Number.isFinite(Number(record.take)) ? Number(record.take) : 1,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    verification: normalizeVerification(record.verification),
  };
}

function normalizeSegments(input: unknown): SegmentRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index): SegmentRecord | null => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const id =
        typeof record.id === 'string' && record.id.trim()
          ? record.id.trim()
          : `${index + 1}`.padStart(4, '0');
      const speakerId =
        typeof record.speakerId === 'string' && record.speakerId.trim()
          ? record.speakerId.trim()
          : 'narrator';
      const text = typeof record.text === 'string' ? record.text : '';
      const order = Number.isFinite(Number(record.order))
        ? Number(record.order)
        : index + 1;
      const status = segmentStatuses.has(record.status as SegmentStatus)
        ? (record.status as SegmentStatus)
        : 'pending';
      if (!text.trim()) {
        return null;
      }

      const emotion: SegmentEmotion =
        record.emotion === 'storytelling' ? 'storytelling' : 'natural';

      return {
        id,
        order,
        speakerId,
        text,
        emotion,
        audioPath:
          typeof record.audioPath === 'string' && record.audioPath.trim()
            ? record.audioPath
            : `audio/segments/${id}-${speakerId}.wav`,
        audioTake:
          Number.isFinite(Number(record.audioTake)) && Number(record.audioTake) > 0
            ? Number(record.audioTake)
            : 1,
        audioCreatedAt:
          typeof record.audioCreatedAt === 'string' ? record.audioCreatedAt : null,
        previousTake: normalizePreviousTake(record.previousTake),
        whisperTranscriptPath:
          typeof record.whisperTranscriptPath === 'string' &&
          record.whisperTranscriptPath.trim()
            ? record.whisperTranscriptPath
            : `tmp/whisper/${id}-${speakerId}.txt`,
        status,
        verification: normalizeVerification(record.verification),
        flagged: record.flagged === true,
      };
    })
    .filter((segment): segment is SegmentRecord => segment !== null);
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const segments = await readSegments(slug);
  return NextResponse.json(segments);
}

export async function PUT(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as SegmentsPayload;
  const incoming = normalizeSegments(body.segments);
  const onDisk = await readSegments(slug);
  const previous = new Map(onDisk.segments.map((segment) => [segment.id, segment]));

  // Generation state (status, verification, and which audio take is current)
  // belongs to the TTS worker, not to the editor, so it is taken from disk
  // rather than from the browser's copy — which can be minutes stale, or
  // mid-run. Only a segment that actually changed (new id, or edited
  // text/speaker/emotion) is reset to pending so the worker regenerates it;
  // everything else keeps the audio it already has.
  const pendingVerification: SegmentVerification = {
    status: 'pending',
    attempts: 0,
    lastError: null,
    transcriptPreview: null,
  };
  const segments = incoming.map((segment) => {
    const prior = previous.get(segment.id);
    const unchanged =
      prior !== undefined &&
      prior.text === segment.text &&
      prior.speakerId === segment.speakerId &&
      prior.emotion === segment.emotion;

    if (prior !== undefined && unchanged) {
      return {
        ...segment,
        status: prior.status,
        verification: prior.verification,
        audioPath: prior.audioPath,
        audioTake: prior.audioTake,
        audioCreatedAt: prior.audioCreatedAt,
        previousTake: prior.previousTake,
      };
    }

    if (segment.status === 'skipped') {
      return { ...segment, status: 'skipped' as const, verification: pendingVerification };
    }

    return { ...segment, status: 'pending' as const, verification: pendingVerification };
  });

  const updated = await writeSegments(slug, { segments });

  // Only an edit that really changed the script sends the story back for
  // re-approval. A save that changed nothing (or only a flag) used to invalidate
  // every approval anyway, forcing a re-approve round for no reason.
  const textChanged =
    updated.segments.length !== onDisk.segments.length ||
    updated.segments.some((segment, index) => {
      const prior = onDisk.segments[index];
      return (
        prior === undefined ||
        prior.id !== segment.id ||
        prior.text !== segment.text ||
        prior.speakerId !== segment.speakerId ||
        prior.emotion !== segment.emotion
      );
    });

  if (textChanged) {
    await patchStory(slug, (story) => ({
      ...story,
      status: 'segments_review',
      approvals: {
        segments: { status: 'pending', approvedAt: null },
        verifiedAudio: { status: 'pending', approvedAt: null },
        finalAudio: { status: 'pending', approvedAt: null },
        finalVideo: { status: 'pending', approvedAt: null },
        metadata: { status: 'pending', approvedAt: null },
      },
      audio: { ...story.audio, status: 'pending' },
      video: { ...story.video, status: 'pending' },
    }));
  }

  const inputCount = Array.isArray(body.segments) ? body.segments.length : 0;
  const droppedCount = Math.max(0, inputCount - segments.length);

  return NextResponse.json({ ...updated, droppedCount });
}
