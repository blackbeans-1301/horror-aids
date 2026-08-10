import 'server-only';

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

import { NextResponse } from 'next/server';

// Readable.toWeb() enqueues into the web ReadableStream's controller from
// inside Node's own internal adapter — if the client aborts mid-stream (very
// common for <audio>/<video>, which cancels and reissues a new Range request
// on every seek) the controller closes first, and a disk read that was
// already in flight then throws ERR_INVALID_STATE from code we don't control.
// That throw isn't catchable with a route-level try/catch and surfaces as an
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

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
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

// Shared by the story asset route and the media catalog preview route: a
// Range/ETag-aware static file response, safe to use with <audio>/<video>
// elements that seek by cancelling and reissuing requests mid-stream.
export async function serveFile(
  request: Request,
  absolutePath: string,
  contentType: string,
): Promise<NextResponse> {
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
}
