import { NextResponse } from 'next/server';

import { startStoryJob } from '@/lib/job-runner';
import type { JobType } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface StartJobPayload {
  type?: unknown;
  segmentIds?: unknown;
}

const jobTypes = new Set<JobType>([
  'process_story',
  'generate_verify_tts',
  'concat_audio',
  'render_video',
]);

export async function POST(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as StartJobPayload;

  if (!jobTypes.has(body.type as JobType)) {
    return NextResponse.json({ error: 'Invalid job type' }, { status: 400 });
  }

  const segmentIds = Array.isArray(body.segmentIds)
    ? body.segmentIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;

  try {
    const job = await startStoryJob(slug, body.type as JobType, { segmentIds });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start job' },
      { status: 400 },
    );
  }
}
