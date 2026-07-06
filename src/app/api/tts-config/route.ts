import { NextResponse } from 'next/server';

function ttsBaseUrl(): string | null {
  const baseUrl = process.env.VIENUE_TTS_BASE_URL?.trim();
  return baseUrl ? baseUrl.replace(/\/$/, '') : null;
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = ttsBaseUrl();

  if (!baseUrl) {
    return NextResponse.json({ error: 'VIENUE_TTS_BASE_URL is not configured' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/config`, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json(
        { error: `TTS server responded with ${response.status}` },
        { status: response.status },
      );
    }
    return NextResponse.json({ ...(await response.json()), baseUrl });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the VieNue TTS server. Is it running?' },
      { status: 502 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const baseUrl = ttsBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: 'VIENUE_TTS_BASE_URL is not configured' }, { status: 400 });
  }

  const body = (await request.json()) as { device?: unknown; model?: unknown };
  const device = typeof body.device === 'string' ? body.device : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  if (!device && !model) {
    return NextResponse.json({ error: 'model or device is required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, device }),
    });
    const data = (await response.json()) as { detail?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail ?? `TTS server responded with ${response.status}` },
        { status: response.status },
      );
    }
    return NextResponse.json({ ...data, baseUrl });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the VieNue TTS server. Is it running?' },
      { status: 502 },
    );
  }
}
