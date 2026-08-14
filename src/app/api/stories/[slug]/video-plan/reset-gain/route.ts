import { NextResponse } from 'next/server';

import { resetVideoPlanGainToLibraryDefaults } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const plan = await resetVideoPlanGainToLibraryDefaults(slug);
  return NextResponse.json({ videoPlan: plan });
}
