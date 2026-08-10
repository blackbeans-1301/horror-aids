import { NextResponse } from 'next/server';

import { getContentStoryDetail } from '@/lib/content-library';

interface LibraryRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: LibraryRouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const detail = await getContentStoryDetail(id);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}
