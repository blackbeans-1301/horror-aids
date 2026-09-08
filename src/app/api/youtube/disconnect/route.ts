import { NextResponse } from 'next/server';

import { disconnectYoutube } from '@/lib/youtube-upload';

export async function POST(): Promise<NextResponse> {
  await disconnectYoutube();
  return NextResponse.json({ ok: true });
}
