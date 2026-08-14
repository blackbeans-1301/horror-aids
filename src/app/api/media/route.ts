import { NextResponse } from 'next/server';

import { addMediaAsset, deleteMediaAsset, readMediaLibrary, updateMediaAsset } from '@/lib/json-store';
import type { GradeOverride, MediaCategory } from '@/types/story';

const MEDIA_CATEGORIES = new Set<MediaCategory>(['bg_music', 'rain_ambience', 'intro_music', 'scene_video']);

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const { media } = await readMediaLibrary();
  const filtered = category ? media.filter((asset) => asset.category === category) : media;
  return NextResponse.json({ media: filtered });
}

function extensionFromFilename(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex) : '';
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');
  const sourcePath = form.get('sourcePath');
  const category = form.get('category');
  const name = form.get('name');
  const source = form.get('source');
  const notes = form.get('notes');
  const loopable = form.get('loopable');

  const hasSourcePath = typeof sourcePath === 'string' && sourcePath.trim().length > 0;
  if (!(file instanceof File) && !hasSourcePath) {
    return NextResponse.json({ error: 'file or sourcePath is required' }, { status: 400 });
  }
  if (hasSourcePath && !sourcePath.trim().startsWith('/')) {
    return NextResponse.json({ error: 'sourcePath must be an absolute path' }, { status: 400 });
  }
  if (typeof category !== 'string' || !MEDIA_CATEGORIES.has(category as MediaCategory)) {
    return NextResponse.json({ error: 'category must be one of bg_music, rain_ambience, intro_music, scene_video' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const extension = extensionFromFilename(hasSourcePath ? sourcePath.trim() : (file as File).name);
  if (!extension) {
    return NextResponse.json({ error: 'File has no extension' }, { status: 400 });
  }

  try {
    const asset = await addMediaAsset({
      category: category as MediaCategory,
      name,
      source: typeof source === 'string' ? source : '',
      notes: typeof notes === 'string' ? notes : '',
      loopable: typeof loopable === 'string' ? loopable === 'true' : true,
      extension,
      ...(hasSourcePath
        ? { sourcePath: sourcePath.trim() }
        : { file: Buffer.from(await (file as File).arrayBuffer()) }),
    });
    return NextResponse.json({ media: asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not add media asset' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const body = (await request.json()) as {
    name?: unknown;
    category?: unknown;
    source?: unknown;
    notes?: unknown;
    loopable?: unknown;
    defaultGainDb?: unknown;
    gradeOverride?: unknown;
  };

  if (body.category !== undefined && !MEDIA_CATEGORIES.has(body.category as MediaCategory)) {
    return NextResponse.json({ error: 'category must be one of bg_music, rain_ambience, intro_music, scene_video' }, { status: 400 });
  }
  if (body.defaultGainDb !== undefined && typeof body.defaultGainDb !== 'number') {
    return NextResponse.json({ error: 'defaultGainDb must be a number' }, { status: 400 });
  }

  let gradeOverride: GradeOverride | undefined;
  if (body.gradeOverride !== undefined) {
    const raw = body.gradeOverride as { brightness?: unknown; vignette?: unknown };
    const brightnessValid = raw.brightness === null || typeof raw.brightness === 'number';
    const vignetteValid = raw.vignette === null || typeof raw.vignette === 'boolean';
    if (!brightnessValid || !vignetteValid) {
      return NextResponse.json(
        { error: 'gradeOverride.brightness must be a number or null, gradeOverride.vignette must be a boolean or null' },
        { status: 400 },
      );
    }
    gradeOverride = {
      brightness: (raw.brightness ?? null) as number | null,
      vignette: (raw.vignette ?? null) as boolean | null,
    };
  }

  try {
    const asset = await updateMediaAsset(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      category: typeof body.category === 'string' ? (body.category as MediaCategory) : undefined,
      source: typeof body.source === 'string' ? body.source : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      loopable: typeof body.loopable === 'boolean' ? body.loopable : undefined,
      defaultGainDb: typeof body.defaultGainDb === 'number' ? body.defaultGainDb : undefined,
      gradeOverride,
    });
    return NextResponse.json({ media: asset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update media asset' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const force = url.searchParams.get('force') === '1';
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    await deleteMediaAsset(id, force);
    return NextResponse.json({ id });
  } catch (error) {
    const referencedBy = (error as Error & { referencedBy?: string[] }).referencedBy;
    if (referencedBy) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Media is in use', referencedBy },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not delete media asset' },
      { status: 400 },
    );
  }
}
