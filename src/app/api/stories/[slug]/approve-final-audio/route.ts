import { NextResponse } from 'next/server';

import { getStoryDetail, setApproval, syncVideoPlanGainToLibraryDefaults } from '@/lib/json-store';

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

  // Approving final audio is the one point where a story's video-plan gain
  // gets refreshed from the media library's current defaults — but only if
  // the operator hasn't hand-tuned it for this story already.
  await syncVideoPlanGainToLibraryDefaults(slug);
  const story = await setApproval(slug, 'finalAudio', 'approved');
  return NextResponse.json({ story });
}
