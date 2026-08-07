import { NextResponse } from 'next/server';

import { getStoryDetail, patchStory } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface PatchStoryPayload {
  title?: unknown;
  rightsStatus?: unknown;
  archived?: unknown;
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  try {
    const detail = await getStoryDetail(slug);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as PatchStoryPayload;

  try {
    const story = await patchStory(slug, (current) => ({
      ...current,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : current.title,
      rightsStatus:
        body.rightsStatus === 'original' ||
        body.rightsStatus === 'permission_recorded' ||
        body.rightsStatus === 'reference_only' ||
        body.rightsStatus === 'risk_acknowledged'
          ? body.rightsStatus
          : current.rightsStatus,
      archived: typeof body.archived === 'boolean' ? body.archived : current.archived,
      archivedAt:
        typeof body.archived === 'boolean'
          ? body.archived
            ? new Date().toISOString()
            : null
          : current.archivedAt,
    }));

    return NextResponse.json({ story });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}
