import { NextResponse } from 'next/server';

import { patchStory, readSegments, writeSegments } from '@/lib/json-store';
import type { SegmentRecord, SegmentStatus, VerificationStatus } from '@/types/story';

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
      const verification =
        typeof record.verification === 'object' && record.verification !== null
          ? (record.verification as Record<string, unknown>)
          : {};
      const verificationStatus = verificationStatuses.has(
        verification.status as VerificationStatus,
      )
        ? (verification.status as VerificationStatus)
        : 'pending';

      if (!text.trim()) {
        return null;
      }

      return {
        id,
        order,
        speakerId,
        text,
        audioPath:
          typeof record.audioPath === 'string' && record.audioPath.trim()
            ? record.audioPath
            : `audio/segments/${id}-${speakerId}.wav`,
        whisperTranscriptPath:
          typeof record.whisperTranscriptPath === 'string' &&
          record.whisperTranscriptPath.trim()
            ? record.whisperTranscriptPath
            : `tmp/whisper/${id}-${speakerId}.txt`,
        status,
        verification: {
          status: verificationStatus,
          attempts:
            typeof verification.attempts === 'number' ? verification.attempts : 0,
          lastError:
            typeof verification.lastError === 'string'
              ? verification.lastError
              : null,
          transcriptPreview:
            typeof verification.transcriptPreview === 'string'
              ? verification.transcriptPreview
              : null,
        },
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
  const segments = normalizeSegments(body.segments);
  const updated = await writeSegments(slug, { segments });

  await patchStory(slug, (story) => ({
    ...story,
    status: 'segments_review',
    approvals: {
      segments: { status: 'pending', approvedAt: null },
      verifiedAudio: { status: 'pending', approvedAt: null },
      finalAudio: { status: 'pending', approvedAt: null },
    },
    audio: { ...story.audio, status: 'pending' },
  }));

  return NextResponse.json(updated);
}
