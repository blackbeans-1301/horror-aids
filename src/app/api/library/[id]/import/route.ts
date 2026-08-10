import { NextResponse } from 'next/server';

import { importContentStory } from '@/lib/content-library';

interface LibraryRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: LibraryRouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const result = await importContentStory(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not import story' },
      { status: 400 },
    );
  }
}
