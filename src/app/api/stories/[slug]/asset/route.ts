import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { resolveAudioAsset } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

// Readable.toWeb() enqueues into the web ReadableStream's controller from
// inside Node's own internal adapter — if the client aborts mid-stream (very
// common for <audio>, which cancels and reissues a new Range request on
// every seek) the controller closes first, and a disk read that was already
// in flight then throws ERR_INVALID_STATE from code we don't control. That
// throw isn't catchable with a route-level try/catch and surfaces as an
// uncaughtException, which by default kills the whole Node process. Bridging
// manually keeps every controller call inside our own try/catch instead.
function fileStreamToWebStream(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        try {
          controller.enqueue(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        } catch {
          // Controller already closed because the client went away — stop reading.
          nodeStream.destroy();
        }
      });
      nodeStream.on('end', () => {
        try {
          controller.close();
        } catch {
          // Already closed — nothing to do.
        }
      });
      nodeStream.on('error', (error) => {
        try {
          controller.error(error);
        } catch {
          // Already closed/errored — nothing to do.
        }
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

function parseRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) {
    return null;
  }
  let start = startRaw ? Number.parseInt(startRaw, 10) : size - Number.parseInt(endRaw, 10);
  let end = endRaw && startRaw ? Number.parseInt(endRaw, 10) : size - 1;
  start = Math.max(start, 0);
  end = Math.min(end, size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return null;
  }
  return { start, end };
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

  try {
    const { absolutePath, contentType } = resolveAudioAsset(slug, relativePath);
    const stat = await fsPromises.stat(absolutePath);
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;

    if (
      request.headers.get('if-none-match') === etag ||
      (request.headers.get('if-modified-since') &&
        new Date(request.headers.get('if-modified-since') as string) >= stat.mtime)
    ) {
      return new NextResponse(null, {
        status: 304,
        headers: { etag, 'last-modified': stat.mtime.toUTCString() },
      });
    }

    const range = parseRange(request.headers.get('range'), stat.size);
    const baseHeaders = {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
      etag,
      'last-modified': stat.mtime.toUTCString(),
    };

    if (range) {
      const stream = fs.createReadStream(absolutePath, { start: range.start, end: range.end });
      return new NextResponse(fileStreamToWebStream(stream), {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'content-length': String(range.end - range.start + 1),
        },
      });
    }

    const stream = fs.createReadStream(absolutePath);
    return new NextResponse(fileStreamToWebStream(stream), {
      headers: {
        ...baseHeaders,
        'content-length': String(stat.size),
      },
    });
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read asset' },
      { status },
    );
  }
}
