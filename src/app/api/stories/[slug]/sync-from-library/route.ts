import { NextResponse } from 'next/server';

import { mergeChapters } from '@/lib/content-library';
import { readStory, writeStoryText } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

// Explicit, destructive re-sync: overwrites the workspace's story text with
// the latest merged chapters from the writing library and resets its
// approvals (via writeStoryText). Deliberately separate from importing a
// library entry — import must stay a safe, non-destructive create-once
// operation (see importContentStory in src/lib/content-library.ts).
export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;

  try {
    const story = await readStory(slug);
    if (!story.sourceContentId) {
      return NextResponse.json(
        { error: 'Story was not imported from the library' },
        { status: 400 },
      );
    }

    const mergedText = await mergeChapters(story.sourceContentId);
    await writeStoryText(slug, mergedText);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not sync from library' },
      { status: 400 },
    );
  }
}
