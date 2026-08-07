import { NextResponse } from 'next/server';

import { stopStoryJob } from '@/lib/job-runner';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;

  try {
    const job = await stopStoryJob(slug);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not stop job' },
      { status: 400 },
    );
  }
}
