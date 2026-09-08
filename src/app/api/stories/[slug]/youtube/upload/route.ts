import { NextResponse } from 'next/server';

import { readStory } from '@/lib/json-store';
import { uploadFinalVideoForStory } from '@/lib/youtube-upload';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

// Approving final video already kicks this off automatically (see the
// approve-final-video route and job-runner's autoApproveAfterJob) — this
// route exists for the operator to retry by hand from the Metadata tab
// after a failed upload, without re-triggering a full video re-render.
export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  try {
    await uploadFinalVideoForStory(slug);
    const story = await readStory(slug);
    return NextResponse.json({ story });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'YouTube upload failed' },
      { status: 400 },
    );
  }
}
