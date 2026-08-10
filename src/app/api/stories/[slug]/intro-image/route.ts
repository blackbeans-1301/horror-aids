import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { readVideoPlanOrDefaults, writeVideoPlan } from '@/lib/json-store';
import { resolveStoryPath, storyDir } from '@/lib/paths';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

const ALLOWED_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_BYTES = 25 * 1024 * 1024;

async function removeExistingIntroImages(slug: string): Promise<void> {
  const videoDir = path.join(storyDir(slug), 'video');
  const entries = await fs.readdir(videoDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith('intro.'))
      .map((entry) => fs.unlink(path.join(videoDir, entry)).catch(() => undefined)),
  );
}

export async function POST(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const extension = ALLOWED_EXTENSIONS[file.type];
  if (!extension) {
    return NextResponse.json({ error: 'Intro image must be JPEG, PNG, or WebP' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Intro image must be 25MB or smaller' }, { status: 400 });
  }

  await removeExistingIntroImages(slug);
  const relativePath = `video/intro${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.mkdir(path.dirname(resolveStoryPath(slug, relativePath)), { recursive: true });
  await fs.writeFile(resolveStoryPath(slug, relativePath), buffer);

  const plan = await readVideoPlanOrDefaults(slug);
  const saved = await writeVideoPlan(slug, { ...plan, introImagePath: relativePath });

  return NextResponse.json({ videoPlan: saved });
}

export async function DELETE(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  await removeExistingIntroImages(slug);
  const plan = await readVideoPlanOrDefaults(slug);
  const saved = await writeVideoPlan(slug, { ...plan, introImagePath: null });
  return NextResponse.json({ videoPlan: saved });
}
