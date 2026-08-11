import { NextResponse } from 'next/server';

import { generateYoutubeMetadata, readStory } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const story = await readStory(slug);

  if (story.approvals.verifiedAudio.status !== 'approved') {
    return NextResponse.json(
      { error: 'Verified audio must be approved before generating YouTube metadata' },
      { status: 400 },
    );
  }

  try {
    const metadata = await generateYoutubeMetadata(slug);
    return NextResponse.json({ metadata });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Metadata generation failed' },
      { status: 502 },
    );
  }
}
