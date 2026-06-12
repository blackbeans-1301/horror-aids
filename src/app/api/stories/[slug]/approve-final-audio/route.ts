import { NextResponse } from 'next/server';

import { getStoryDetail, setApproval } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const detail = await getStoryDetail(slug);

  if (!detail.finalAudioExists) {
    return NextResponse.json(
      { error: 'Final audio does not exist yet' },
      { status: 400 },
    );
  }

  const story = await setApproval(slug, 'finalAudio', 'approved');
  return NextResponse.json({ story });
}
