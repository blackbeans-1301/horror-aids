import { NextResponse } from 'next/server';

import { deleteVideoRender } from '@/lib/json-store';

interface RouteContext {
  params: Promise<{ slug: string; jobId: string }>;
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { slug, jobId } = await context.params;

  try {
    await deleteVideoRender(slug, jobId);
    return NextResponse.json({ jobId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not delete render' },
      { status: 400 },
    );
  }
}
