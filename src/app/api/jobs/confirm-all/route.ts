import { NextResponse } from 'next/server';

import { confirmAllFinishedJobs, readJobs } from '@/lib/json-store';

export async function POST(): Promise<NextResponse> {
  await confirmAllFinishedJobs();
  const updated = await readJobs();
  return NextResponse.json(updated);
}
