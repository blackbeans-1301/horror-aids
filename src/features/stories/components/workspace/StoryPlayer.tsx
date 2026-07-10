import { ListMusic, SkipBack, SkipForward, Square } from 'lucide-react';
import React from 'react';

import { assetUrl } from '@/features/stories/utils/asset';
import type { SegmentRecord } from '@/types/story';

interface StoryPlayerProps {
  slug: string;
  playableSegments: SegmentRecord[];
  playingSegment: SegmentRecord | null;
  playerIndex: number | null;
  setPlayerIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onSegmentEnded: () => void;
}

export const StoryPlayer: React.FC<StoryPlayerProps> = ({
  slug,
  playableSegments,
  playingSegment,
  playerIndex,
  setPlayerIndex,
  onSegmentEnded,
}) => {
  return (
    <div className="panel">
      <h3>Story Player</h3>
      {playableSegments.length === 0 ? (
        <p className="label">No segment audio yet. Generate TTS first.</p>
      ) : (
        <>
          <div className="button-row">
            <button className="button" type="button" onClick={() => setPlayerIndex(0)} disabled={playerIndex !== null}>
              <ListMusic size={16} aria-hidden="true" />
              Play all ({playableSegments.length} segments)
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setPlayerIndex((current) => (current !== null && current > 0 ? current - 1 : current))}
              disabled={playerIndex === null || playerIndex === 0}
            >
              <SkipBack size={16} aria-hidden="true" />
              Previous
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                setPlayerIndex((current) =>
                  current !== null && current < playableSegments.length - 1 ? current + 1 : current,
                )
              }
              disabled={playerIndex === null || playerIndex >= playableSegments.length - 1}
            >
              <SkipForward size={16} aria-hidden="true" />
              Next
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setPlayerIndex(null)}
              disabled={playerIndex === null}
            >
              <Square size={16} aria-hidden="true" />
              Stop
            </button>
          </div>
          {playingSegment ? (
            <>
              <p className="label">
                Playing {(playerIndex ?? 0) + 1}/{playableSegments.length} — segment {playingSegment.id} [
                {playingSegment.speakerId}]: {playingSegment.text.slice(0, 120)}
                {playingSegment.text.length > 120 ? '…' : ''}
              </p>
              <audio
                autoPlay
                controls
                key={playingSegment.id}
                onEnded={onSegmentEnded}
                src={assetUrl(slug, playingSegment.audioPath)}
                style={{ width: '100%' }}
              />
            </>
          ) : (
            <p className="label">Press Play all to hear the story in order without concat.</p>
          )}
        </>
      )}
    </div>
  );
};

export default StoryPlayer;
