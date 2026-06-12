import { NextResponse } from 'next/server';

import { readJobs } from '@/lib/json-store';

export async function GET(): Promise<NextResponse> {
  const jobs = await readJobs();
  return NextResponse.json(jobs);
}
