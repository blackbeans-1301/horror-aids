import { NextResponse } from 'next/server';

import { replaceVoiceWav } from '@/lib/json-store';

interface VoiceRouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: VoiceRouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const body = (await request.json()) as { wavBase64?: unknown };
  if (typeof body.wavBase64 !== 'string') {
    return NextResponse.json({ error: 'wavBase64 is required' }, { status: 400 });
  }

  let wav: Buffer;
  try {
    wav = Buffer.from(body.wavBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'wavBase64 is not valid base64' }, { status: 400 });
  }
  if (wav.length === 0) {
    return NextResponse.json({ error: 'wavBase64 decoded to an empty file' }, { status: 400 });
  }

  try {
    const voice = await replaceVoiceWav(id, wav);
    return NextResponse.json({ id: voice.id, description: voice.name, kind: 'clone' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not replace voice audio' },
      { status: 404 },
    );
  }
}
