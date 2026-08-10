import { NextResponse } from 'next/server';

import { selectVideoRender } from '@/lib/json-store';

interface RouteContext {
  params: Promise<{ slug: string; jobId: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { slug, jobId } = await context.params;

  try {
    const story = await selectVideoRender(slug, jobId);
    return NextResponse.json({ story });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not select render' },
      { status: 400 },
    );
  }
}
