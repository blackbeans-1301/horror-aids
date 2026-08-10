import { NextResponse } from 'next/server';

import { serveFile } from '@/lib/asset-stream';
import { resolveStoryAsset } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    return NextResponse.json({ error: 'Path is required' }, { status: 400 });
  }

  if (!relativePath.startsWith('audio/') && !relativePath.startsWith('video/')) {
    return NextResponse.json({ error: 'Only audio or video assets can be served' }, { status: 400 });
  }

  try {
    const { absolutePath, contentType } = resolveStoryAsset(slug, relativePath, ['audio', 'video']);
    return await serveFile(request, absolutePath, contentType);
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read asset' },
      { status },
    );
  }
}
