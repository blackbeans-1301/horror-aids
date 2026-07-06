import { NextResponse } from 'next/server';

const SAMPLE_TEXT =
  'Đêm đó, trời mưa tầm tã. Tiếng gõ cửa vang lên từ căn nhà hoang cuối ngõ.';

export async function GET(request: Request): Promise<NextResponse> {
  const baseUrl = process.env.VIENUE_TTS_BASE_URL?.trim()?.replace(/\/$/, '');
  if (!baseUrl) {
    return NextResponse.json({ error: 'VIENUE_TTS_BASE_URL is not configured' }, { status: 400 });
  }

  const url = new URL(request.url);
  const voice = url.searchParams.get('voice');
  const emotion = url.searchParams.get('emotion') ?? 'storytelling';
  if (!voice) {
    return NextResponse.json({ error: 'voice query param is required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: SAMPLE_TEXT,
        voice,
        emotion,
        response_format: 'wav',
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { detail?: string };
      return NextResponse.json(
        { error: data.detail ?? `TTS server responded with ${response.status}` },
        { status: response.status },
      );
    }
    const audio = await response.arrayBuffer();
    return new NextResponse(audio, {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the VieNue TTS server. Is it running?' },
      { status: 502 },
    );
  }
}
