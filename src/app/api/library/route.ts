import { NextResponse } from 'next/server';

import { listContentStories } from '@/lib/content-library';

export async function GET(): Promise<NextResponse> {
  const stories = await listContentStories();
  return NextResponse.json({ stories });
}
