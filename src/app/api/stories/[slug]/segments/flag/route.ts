import { NextResponse } from 'next/server';

import { readSegments, writeSegments } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface FlagPayload {
  segmentId?: unknown;
  flagged?: unknown;
}

export async function PATCH(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as FlagPayload;

  if (typeof body.segmentId !== 'string' || !body.segmentId.trim()) {
    return NextResponse.json({ error: 'segmentId is required' }, { status: 400 });
  }
  if (typeof body.flagged !== 'boolean') {
    return NextResponse.json({ error: 'flagged must be a boolean' }, { status: 400 });
  }

  try {
    const current = await readSegments(slug);
    const segmentId = body.segmentId;
    const flagged = body.flagged;
    if (!current.segments.some((segment) => segment.id === segmentId)) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
    }

    // This is a lightweight metadata toggle only — unlike the full segments
    // PUT, it must not reset the story's status/approvals, since flagging a
    // segment for review doesn't invalidate already-approved work.
    const updated = await writeSegments(slug, {
      segments: current.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, flagged } : segment,
      ),
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}
