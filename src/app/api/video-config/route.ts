import { NextResponse } from 'next/server';

import { readVideoAppConfig } from '@/lib/json-store';

// The only thing the client needs from the video config today is the global
// grade default, to resolve brightness/vignette client-side (see
// resolveGrade in src/lib/grade.ts) for the live CSS preview.
export async function GET(): Promise<NextResponse> {
  const config = await readVideoAppConfig();
  return NextResponse.json({ grade: config.grade });
}
