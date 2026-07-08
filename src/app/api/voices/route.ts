import { NextResponse } from 'next/server';

import { addVoice, deleteVoice, readVoices } from '@/lib/json-store';

export interface VoiceOption {
  id: string;
  description: string;
  kind: 'preset' | 'clone';
}

export async function GET(): Promise<NextResponse> {
  const { voices } = await readVoices();
  const options: VoiceOption[] = voices.map((voice) => ({
    id: voice.id,
    description: voice.name,
    kind: 'clone',
  }));
  return NextResponse.json({ voices: options });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { name?: unknown; wavBase64?: unknown };
  if (typeof body.name !== 'string' || !body.name.trim() || typeof body.wavBase64 !== 'string') {
    return NextResponse.json({ error: 'name and wavBase64 are required' }, { status: 400 });
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

  const voice = await addVoice(body.name, wav);
  return NextResponse.json({ id: voice.id, description: voice.name, kind: 'clone' });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const voiceId = url.searchParams.get('id');
  if (!voiceId) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  await deleteVoice(voiceId);
  return NextResponse.json({ id: voiceId });
}
