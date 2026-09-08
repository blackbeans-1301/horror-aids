import { NextResponse } from 'next/server';

import { exchangeYoutubeAuthCode } from '@/lib/youtube-upload';

// Google redirects the browser here after the operator grants (or denies)
// consent on the OAuth screen — bounce straight back to Settings either way,
// with a query flag it uses to show a success/error toast.
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const settingsUrl = new URL('/settings', url.origin);

  if (oauthError) {
    settingsUrl.searchParams.set('youtube', 'error');
    settingsUrl.searchParams.set('youtubeError', oauthError);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set('youtube', 'error');
    settingsUrl.searchParams.set('youtubeError', 'missing_code');
    return NextResponse.redirect(settingsUrl);
  }

  try {
    await exchangeYoutubeAuthCode(code);
    settingsUrl.searchParams.set('youtube', 'connected');
  } catch (error) {
    settingsUrl.searchParams.set('youtube', 'error');
    settingsUrl.searchParams.set(
      'youtubeError',
      error instanceof Error ? error.message : 'token_exchange_failed',
    );
  }

  return NextResponse.redirect(settingsUrl);
}
