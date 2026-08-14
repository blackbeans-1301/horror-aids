import 'server-only';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { readJsonFile, readMediaLibrary } from '@/lib/json-store';
import { configRoot, projectRoot, pythonExecutable, workersRoot } from '@/lib/paths';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_SATURATION = 0.85;

function runPreview(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), args, { cwd: projectRoot, env: process.env });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `render_grade_preview exited with code ${code}`));
      }
    });
  });
}

// Accurate on-demand preview: renders a short (few-second) clip of a scene
// video through the exact same eq/vignette filter chain render_video.py
// uses for the real render (shared via common.build_scene_grade_filter), so
// the operator can verify precisely what a grade override will look like —
// unlike the instant CSS-filter preview, which is only an approximation.
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { brightness?: unknown; vignette?: unknown } | null;
  const brightness = typeof body?.brightness === 'number' ? body.brightness : null;
  const vignette = typeof body?.vignette === 'boolean' ? body.vignette : null;
  if (brightness === null || vignette === null) {
    return NextResponse.json({ error: 'brightness (number) and vignette (boolean) are required' }, { status: 400 });
  }

  const { media } = await readMediaLibrary();
  const asset = media.find((entry) => entry.id === id);
  if (!asset || asset.category !== 'scene_video') {
    return NextResponse.json({ error: `Unknown scene video: ${id}` }, { status: 404 });
  }

  const config = await readJsonFile<{ video?: { grade?: { saturation?: number } } }>(
    path.join(configRoot, 'app.json'),
    {},
  );
  const saturation = config.video?.grade?.saturation ?? DEFAULT_SATURATION;

  const outputPath = path.join(os.tmpdir(), `horror-aids-grade-preview-${randomUUID()}.mp4`);
  try {
    await runPreview([
      path.join(workersRoot, 'render_grade_preview.py'),
      '--project-root',
      projectRoot,
      '--asset',
      id,
      '--brightness',
      String(brightness),
      '--saturation',
      String(saturation),
      '--vignette',
      vignette ? 'true' : 'false',
      '--duration',
      '4',
      '--output',
      outputPath,
    ]);
    const clip = await fs.readFile(outputPath);
    return new NextResponse(clip, { headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Grade preview render failed' },
      { status: 502 },
    );
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}
