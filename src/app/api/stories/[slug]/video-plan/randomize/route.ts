import { NextResponse } from 'next/server';

import { randomizeVideoPlan } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const plan = await randomizeVideoPlan(slug);
  return NextResponse.json({ videoPlan: plan });
}
