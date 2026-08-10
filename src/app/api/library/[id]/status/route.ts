import { NextResponse } from 'next/server';

import { setContentStoryStatus } from '@/lib/content-library';
import type { ContentStoryEditorialStatus } from '@/types/story';

interface LibraryRouteContext {
  params: Promise<{ id: string }>;
}

interface SetStatusPayload {
  status?: unknown;
}

// 'processing'/'archived' are derived from the linked workspace's real state
// (see deriveStatus in src/lib/content-library.ts) — they can't be set here.
const statuses = new Set<ContentStoryEditorialStatus>(['draft', 'approved']);

export async function POST(
  request: Request,
  context: LibraryRouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = (await request.json()) as SetStatusPayload;

  if (!statuses.has(body.status as ContentStoryEditorialStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  try {
    await setContentStoryStatus(id, body.status as ContentStoryEditorialStatus);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update status' },
      { status: 400 },
    );
  }
}
