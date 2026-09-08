import { NextResponse } from 'next/server';

import { getYoutubeConnectionStatus } from '@/lib/youtube-upload';

export async function GET(): Promise<NextResponse> {
  const status = await getYoutubeConnectionStatus();
  return NextResponse.json(status);
}
