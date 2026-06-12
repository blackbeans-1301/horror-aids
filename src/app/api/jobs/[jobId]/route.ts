import { NextResponse } from 'next/server';

import { readJobs } from '@/lib/json-store';

interface JobRouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(
  _request: Request,
  context: JobRouteContext,
): Promise<NextResponse> {
  const { jobId } = await context.params;
  const jobs = await readJobs();
  const job = jobs.jobs.find((candidate) => candidate.id === jobId);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({ job });
}
