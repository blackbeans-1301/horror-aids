import { NextResponse } from 'next/server';

import { getStoryDetail, setApproval } from '@/lib/json-store';
import { uploadFinalVideoForStory } from '@/lib/youtube-upload';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const detail = await getStoryDetail(slug);

  if (!detail.finalVideoExists) {
    return NextResponse.json(
      { error: 'Final video does not exist yet' },
      { status: 400 },
    );
  }

  const story = await setApproval(slug, 'finalVideo', 'approved');

  // Kick off the YouTube upload in the background — best-effort, failures
  // are recorded on story.youtube (see uploadFinalVideoForStory) rather than
  // surfaced here, so approving still succeeds even if YouTube isn't
  // connected yet or the upload itself fails.
  void uploadFinalVideoForStory(slug).catch(() => {});

  return NextResponse.json({ story });
}
