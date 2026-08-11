import { NextResponse } from 'next/server';

import { patchStory, readSegments, writeSegments } from '@/lib/json-store';
import type { SegmentStatus } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface SelectTakePayload {
  segmentId?: unknown;
}

// Swaps a segment's current audio take with its previousTake. Symmetric: a
// segment always keeps exactly two takes on disk (see generate_verify_tts.py),
// so calling this again swaps back — the operator can flip between "before"
// and "after" a regeneration without losing either file.
export async function PATCH(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as SelectTakePayload;

  if (typeof body.segmentId !== 'string' || !body.segmentId.trim()) {
    return NextResponse.json({ error: 'segmentId is required' }, { status: 400 });
  }

  try {
    const current = await readSegments(slug);
    const segmentId = body.segmentId;
    const target = current.segments.find((segment) => segment.id === segmentId);
    if (!target) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
    }
    if (!target.previousTake) {
      return NextResponse.json({ error: 'No previous take to switch to' }, { status: 400 });
    }
    const previousTake = target.previousTake;

    const swappedStatus: SegmentStatus =
      target.status === 'skipped'
        ? 'skipped'
        : previousTake.verification.status === 'passed'
          ? 'complete'
          : 'verification_failed';

    const updated = await writeSegments(slug, {
      segments: current.segments.map((segment) => {
        if (segment.id !== segmentId) {
          return segment;
        }
        return {
          ...segment,
          audioPath: previousTake.path,
          audioTake: previousTake.take,
          audioCreatedAt: previousTake.createdAt,
          verification: previousTake.verification,
          status: swappedStatus,
          previousTake: {
            path: segment.audioPath,
            take: segment.audioTake,
            createdAt: segment.audioCreatedAt,
            verification: segment.verification,
          },
        };
      }),
    });

    // Switching which take is "current" changes the actual audio a concat
    // would use, same as a fresh regeneration — an existing verifiedAudio
    // approval must not silently carry over to a different take.
    await patchStory(slug, (story) =>
      story.approvals.verifiedAudio.status === 'approved'
        ? { ...story, approvals: { ...story.approvals, verifiedAudio: { status: 'pending', approvedAt: null } } }
        : story,
    );

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}
