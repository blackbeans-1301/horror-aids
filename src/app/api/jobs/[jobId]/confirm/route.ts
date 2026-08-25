import { NextResponse } from 'next/server';

import { confirmJob, readJobs } from '@/lib/json-store';

interface JobRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(
  _request: Request,
  context: JobRouteContext,
): Promise<NextResponse> {
  const { jobId } = await context.params;
  const { jobs } = await readJobs();
  if (!jobs.some((job) => job.id === jobId)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  await confirmJob(jobId);
  const updated = await readJobs();
  return NextResponse.json(updated);
}
