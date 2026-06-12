import { NextResponse } from 'next/server';

import { readSegments, setApproval } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const segments = await readSegments(slug);
  const failingSegment = segments.segments.find(
    (segment) =>
      segment.status !== 'skipped' && segment.verification.status !== 'passed',
  );

  if (failingSegment) {
    return NextResponse.json(
      { error: `Segment ${failingSegment.id} is not verified` },
      { status: 400 },
    );
  }

  const story = await setApproval(slug, 'verifiedAudio', 'approved');
  return NextResponse.json({ story });
}
