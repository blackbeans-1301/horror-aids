import { NextResponse } from 'next/server';

import { readMediaLibrary, readVideoPlanOrDefaults, writeVideoPlan } from '@/lib/json-store';
import type { MediaCategory, VideoPlanFile } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

const ROLE_CATEGORIES: Array<{ field: keyof VideoPlanFile; category: MediaCategory }> = [
  { field: 'sceneVideoId', category: 'scene_video' },
  { field: 'introMusicId', category: 'intro_music' },
  { field: 'bgMusicId', category: 'bg_music' },
  { field: 'rainAmbienceId', category: 'rain_ambience' },
];

async function validatePlanIds(plan: VideoPlanFile): Promise<string | null> {
  const { media } = await readMediaLibrary();
  const byId = new Map(media.map((asset) => [asset.id, asset]));
  for (const role of ROLE_CATEGORIES) {
    const id = plan[role.field];
    if (typeof id !== 'string' || !id) {
      continue;
    }
    const asset = byId.get(id);
    if (!asset) {
      return `Unknown media id: ${id}`;
    }
    if (asset.category !== role.category) {
      return `Media "${id}" is a ${asset.category}, not a ${role.category}`;
    }
  }
  return null;
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  try {
    const plan = await readVideoPlanOrDefaults(slug);
    return NextResponse.json({ videoPlan: plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load video plan' },
      { status: 404 },
    );
  }
}

export async function PUT(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as Partial<VideoPlanFile>;
  const current = await readVideoPlanOrDefaults(slug);

  const next: VideoPlanFile = {
    ...current,
    ...body,
    schemaVersion: current.schemaVersion,
    introImagePath: current.introImagePath,
  };

  const validationError = await validatePlanIds(next);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const saved = await writeVideoPlan(slug, next);
  return NextResponse.json({ videoPlan: saved });
}
