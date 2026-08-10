import { NextResponse } from 'next/server';

import { pumpQueue } from '@/lib/job-runner';
import { createStory, listStories } from '@/lib/json-store';
import type { SourceType } from '@/types/story';

interface CreateStoryPayload {
  title?: unknown;
  sourceType?: unknown;
  storyText?: unknown;
}

export async function GET(): Promise<NextResponse> {
  // Same self-healing pump as the story detail route: the dashboard polls this
  // one, so a queue orphaned by a restart resumes as soon as any page is open.
  void pumpQueue();
  const stories = await listStories();
  return NextResponse.json({ stories });
}

const sourceTypes = new Set<SourceType>([
  'manual',
  'generated_later',
  'reddit_reference_later',
  'reddit_import_later',
]);

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as CreateStoryPayload;
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const sourceType: SourceType = sourceTypes.has(body.sourceType as SourceType)
    ? (body.sourceType as SourceType)
    : 'manual';
  const storyText = typeof body.storyText === 'string' ? body.storyText : '';
  const story = await createStory({ title, sourceType, storyText });

  return NextResponse.json({ story }, { status: 201 });
}
