import { NextResponse } from 'next/server';

import { generateYoutubeMetadata } from '@/lib/json-store';
import { ALL_YOUTUBE_METADATA_FIELD_GROUPS } from '@/lib/openai-metadata';
import type { YoutubeMetadataFieldGroup } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;

  const body = (await request.json().catch(() => null)) as { fields?: YoutubeMetadataFieldGroup[] } | null;
  const requested = (body?.fields ?? []).filter((field): field is YoutubeMetadataFieldGroup =>
    (ALL_YOUTUBE_METADATA_FIELD_GROUPS as string[]).includes(field),
  );

  try {
    const metadata = await generateYoutubeMetadata(slug, requested.length > 0 ? requested : undefined);
    return NextResponse.json({ metadata });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Metadata generation failed' },
      { status: 502 },
    );
  }
}
