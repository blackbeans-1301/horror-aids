import { NextResponse } from 'next/server';

import { readCharacters, readSegments, setApproval, writeSegments } from '@/lib/json-store';

interface StoryRouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(
  _request: Request,
  context: StoryRouteContext,
): Promise<NextResponse> {
  const { slug } = await context.params;
  const [{ characters }, segmentsFile] = await Promise.all([
    readCharacters(slug),
    readSegments(slug),
  ]);
  const characterIds = new Set(characters.map((character) => character.id));
  const usedSpeakerIds = new Set(
    segmentsFile.segments
      .filter((segment) => segment.status !== 'skipped')
      .map((segment) => segment.speakerId),
  );

  if (!characters.some((character) => character.role === 'narrator')) {
    return NextResponse.json({ error: 'Narrator is required' }, { status: 400 });
  }

  for (const speakerId of usedSpeakerIds) {
    const character = characters.find((candidate) => candidate.id === speakerId);
    if (!characterIds.has(speakerId) || !character?.voice.trim()) {
      return NextResponse.json(
        { error: `Speaker ${speakerId} needs a valid character and voice` },
        { status: 400 },
      );
    }
  }

  // Approving is a gate on the *text*, not a reset of audio progress. A
  // segment that already generated and passed keeps its "complete" status so
  // the TTS worker still sees it as done — re-approving after an edit used to
  // stamp every segment back to "ready", which made the next full run
  // regenerate hundreds of already-finished segments from scratch.
  const approvedSegments = await writeSegments(slug, {
    segments: segmentsFile.segments.map((segment) => ({
      ...segment,
      status:
        segment.status === 'skipped'
          ? 'skipped'
          : segment.verification.status === 'passed'
            ? 'complete'
            : 'ready',
    })),
  });
  const story = await setApproval(slug, 'segments', 'approved');

  return NextResponse.json({ story, segments: approvedSegments.segments });
}
