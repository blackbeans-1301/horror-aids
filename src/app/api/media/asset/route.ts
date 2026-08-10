import path from 'node:path';

import { NextResponse } from 'next/server';

import { serveFile } from '@/lib/asset-stream';
import { readMediaLibrary, resolveMediaAssetFile } from '@/lib/json-store';

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const { media } = await readMediaLibrary();
  const asset = media.find((entry) => entry.id === id);
  if (!asset) {
    return NextResponse.json({ error: `Unknown media id: ${id}` }, { status: 404 });
  }

  const absolutePath = resolveMediaAssetFile(asset);
  const contentType = CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';

  try {
    return await serveFile(request, absolutePath, contentType);
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read media file' },
      { status },
    );
  }
}
