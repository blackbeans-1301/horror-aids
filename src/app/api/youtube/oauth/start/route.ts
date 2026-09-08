import { NextResponse } from 'next/server';

import { buildYoutubeAuthUrl } from '@/lib/youtube-upload';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.redirect(buildYoutubeAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start YouTube OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
