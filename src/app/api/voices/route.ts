import { NextResponse } from 'next/server';

export interface VoiceOption {
  id: string;
  description: string;
  kind: 'preset' | 'clone';
}

function ttsBaseUrl(): string | null {
  const baseUrl = process.env.VIENUE_TTS_BASE_URL?.trim();
  return baseUrl ? baseUrl.replace(/\/$/, '') : null;
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = ttsBaseUrl();

  if (!baseUrl) {
    return NextResponse.json({ voices: [], error: 'VIENUE_TTS_BASE_URL is not configured' });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/voices`, { cache: 'no-store' });
    if (!response.ok) {
      return NextResponse.json({
        voices: [],
        error: `Voice server responded with ${response.status}`,
      });
    }
    const data = (await response.json()) as { voices?: VoiceOption[] };
    return NextResponse.json({ voices: data.voices ?? [] });
  } catch {
    return NextResponse.json({
      voices: [],
      error: 'Could not reach the VieNue TTS server. Is it running?',
    });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const baseUrl = ttsBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: 'VIENUE_TTS_BASE_URL is not configured' }, { status: 400 });
  }

  const body = (await request.json()) as { name?: unknown; wavBase64?: unknown };
  if (typeof body.name !== 'string' || typeof body.wavBase64 !== 'string') {
    return NextResponse.json({ error: 'name and wavBase64 are required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/voices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: body.name, wav_base64: body.wavBase64 }),
    });
    const data = (await response.json()) as { detail?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail ?? `Voice server responded with ${response.status}` },
        { status: response.status },
      );
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the VieNue TTS server. Is it running?' },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const baseUrl = ttsBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: 'VIENUE_TTS_BASE_URL is not configured' }, { status: 400 });
  }

  const url = new URL(request.url);
  const voiceId = url.searchParams.get('id');
  if (!voiceId) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
    });
    const data = (await response.json()) as { detail?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail ?? `Voice server responded with ${response.status}` },
        { status: response.status },
      );
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the VieNue TTS server. Is it running?' },
      { status: 502 },
    );
  }
}
