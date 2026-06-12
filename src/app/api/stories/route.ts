import { NextResponse } from 'next/server';

import { createStory, listStories } from '@/lib/json-store';
import type { SourceType } from '@/types/story';

interface CreateStoryPayload {
  title?: unknown;
  sourceType?: unknown;
  storyText?: unknown;
}

export async function GET(): Promise<NextResponse> {
  const stories = await listStories();
  return NextResponse.json({ stories });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as CreateStoryPayload;
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const sourceType: SourceType =
    body.sourceType === 'manual' ? 'manual' : 'manual';
  const storyText = typeof body.storyText === 'string' ? body.storyText : '';
  const story = await createStory({ title, sourceType, storyText });

  return NextResponse.json({ story }, { status: 201 });
}
