import { NextResponse } from 'next/server';

import { readYoutubeMetadataOrDefault, setApproval } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const metadata = await readYoutubeMetadataOrDefault(slug);

  if (metadata.status !== 'generated') {
    return NextResponse.json(
      { error: 'Generate metadata before approving it' },
      { status: 400 },
    );
  }

  const story = await setApproval(slug, 'metadata', 'approved');
  return NextResponse.json({ story });
}
