import { NextResponse } from 'next/server';

import { readYoutubeMetadataOrDefault, updateYoutubeMetadata } from '@/lib/json-store';
import type { YoutubeMetadataFile } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const metadata = await readYoutubeMetadataOrDefault(slug);
  return NextResponse.json({ metadata });
}

export async function PUT(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as Partial<YoutubeMetadataFile>;
  const metadata = await updateYoutubeMetadata(slug, body);
  return NextResponse.json({ metadata });
}
