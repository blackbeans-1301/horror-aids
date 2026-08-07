import { NextResponse } from 'next/server';

import { readCharacters, writeCharacters } from '@/lib/json-store';
import type { CharacterRecord, CharacterRole } from '@/types/story';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

interface CharactersPayload {
  characters?: unknown;
}

const validRoles = new Set<CharacterRole>([
  'narrator',
  'main_character',
  'side_character',
  'villain',
  'other',
]);

function normalizeCharacters(input: unknown): CharacterRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item): CharacterRecord | null => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const role = validRoles.has(record.role as CharacterRole)
        ? (record.role as CharacterRole)
        : 'other';
      const voice = typeof record.voice === 'string' ? record.voice.trim() : '';

      if (!id || !name) {
        return null;
      }

      return { id, name, role, voice };
    })
    .filter((character): character is CharacterRecord => character !== null);
}

export async function GET(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const characters = await readCharacters(slug);
  return NextResponse.json(characters);
}

export async function PUT(
  request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const body = (await request.json()) as CharactersPayload;
  const characters = normalizeCharacters(body.characters);

  if (!characters.some((character) => character.role === 'narrator')) {
    return NextResponse.json(
      { error: 'At least one narrator is required' },
      { status: 400 },
    );
  }

  const updated = await writeCharacters(slug, { characters });
  const inputCount = Array.isArray(body.characters) ? body.characters.length : 0;
  const droppedCount = Math.max(0, inputCount - characters.length);

  return NextResponse.json({ ...updated, droppedCount });
}
