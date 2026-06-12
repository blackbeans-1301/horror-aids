import { NextResponse } from 'next/server';

import { readStoryText, writeStoryText } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface StoryTextPayload {
  storyText?: unknown;
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const storyText = await readStoryText(slug);
  return NextResponse.json({ storyText });
}

export async function PUT(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as StoryTextPayload;
  const storyText = typeof body.storyText === 'string' ? body.storyText : '';
  await writeStoryText(slug, storyText);
  return NextResponse.json({ storyText });
}
