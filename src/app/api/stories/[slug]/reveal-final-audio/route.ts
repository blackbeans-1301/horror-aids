import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { readStory } from '@/lib/json-store';
import { resolveStoryPath } from '@/lib/paths';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;

  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'Reveal in Finder is only supported on macOS' },
      { status: 400 },
    );
  }

  try {
    const story = await readStory(slug);
    const absolutePath = resolveStoryPath(slug, story.audio.finalPath);

    try {
      await fs.access(absolutePath);
    } catch {
      return NextResponse.json({ error: 'Final audio does not exist yet' }, { status: 404 });
    }

    // -R selects the file in a new/existing Finder window rather than opening it.
    spawn('open', ['-R', absolutePath], { stdio: 'ignore' }).on('error', () => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Story not found' },
      { status: 404 },
    );
  }
}
