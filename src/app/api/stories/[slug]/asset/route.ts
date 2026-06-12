import { NextResponse } from 'next/server';

import { getAsset } from '@/lib/json-store';

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

  if (!relativePath.startsWith('audio/')) {
    return NextResponse.json({ error: 'Only audio assets can be served' }, { status: 400 });
  }

  const asset = await getAsset(slug, relativePath);
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      'content-type': asset.contentType,
      'cache-control': 'no-store',
    },
  });
}
