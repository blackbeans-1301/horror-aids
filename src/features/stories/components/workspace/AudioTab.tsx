import { AudioLines, Check, Download, Flag, FolderOpen, Play, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { StoryPlayer } from '@/features/stories/components/workspace/StoryPlayer';
import { assetUrl, segmentAudioPath } from '@/features/stories/utils/asset';
import { formatClockDuration } from '@/features/stories/utils/format';
import { withSlot } from '@/features/stories/utils/loadQueue';
import type { JobType, SegmentRecord } from '@/types/story';

const AudioDurationCell: React.FC<{ src: string }> = ({ src }) => {
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    setDuration(null);
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;
    let handleDurationUpdate: (() => void) | null = null;
    let handleTimeUpdate: (() => void) | null = null;

    // Gated through withSlot() so a table with hundreds of segments doesn't
    // fire that many concurrent requests to the asset route on mount.
    void withSlot(
      () =>
        new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }
          audio = new Audio(src);
          // Some WAV encoders leave the RIFF size field as a streaming placeholder,
          // so Chrome reports duration as Infinity until it seeks to the end —
          // force that seek, then jump back to 0 once the real duration is known.
          handleDurationUpdate = (): void => {
            if (Number.isFinite(audio!.duration)) {
              setDuration(audio!.duration);
              resolve();
              return;
            }
            audio!.currentTime = Number.MAX_SAFE_INTEGER;
          };
          handleTimeUpdate = (): void => {
            if (Number.isFinite(audio!.duration)) {
              setDuration(audio!.duration);
            }
            audio!.currentTime = 0;
            resolve();
          };
          audio.addEventListener('loadedmetadata', handleDurationUpdate);
          audio.addEventListener('durationchange', handleDurationUpdate);
          audio.addEventListener('timeupdate', handleTimeUpdate);
          audio.addEventListener('error', () => resolve(), { once: true });
        }),
    );

    return () => {
      cancelled = true;
      if (audio) {
        if (handleDurationUpdate) {
          audio.removeEventListener('loadedmetadata', handleDurationUpdate);
          audio.removeEventListener('durationchange', handleDurationUpdate);
        }
        if (handleTimeUpdate) {
          audio.removeEventListener('timeupdate', handleTimeUpdate);
        }
      }
    };
  }, [src]);

  if (duration === null) {
    return <span className="label">…</span>;
  }
  return <span className="mono">{formatClockDuration(duration)}</span>;
};

interface AudioTabProps {
  slug: string;
  segments: SegmentRecord[];
  canGenerate: boolean;
  canConfirmVerified: boolean;
  canConcat: boolean;
  finalAudioExists: boolean;
  finalAudioPath: string;
  regenSelection: Set<string>;
  onToggleRegenSelection: (segmentId: string) => void;
  onStartJob: (type: JobType, segmentIds?: string[]) => void;
  onClearRegenSelection: () => void;
  onConfirmVerifiedAudio: () => void;
  onApproveFinalAudio: () => void;
  onRevealFinalAudio: () => void;
  playableSegments: SegmentRecord[];
  playingSegment: SegmentRecord | null;
  playerIndex: number | null;
  setPlayerIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onSegmentEnded: () => void;
  onPlayFromSegment: (segmentId: string) => void;
  onToggleSegmentFlag: (segmentId: string) => void;
}

export const AudioTab: React.FC<AudioTabProps> = ({
  slug,
  segments,
  canGenerate,
  canConfirmVerified,
  canConcat,
  finalAudioExists,
  finalAudioPath,
  regenSelection,
  onToggleRegenSelection,
  onStartJob,
  onClearRegenSelection,
  onConfirmVerifiedAudio,
  onApproveFinalAudio,
  onRevealFinalAudio,
  playableSegments,
  playingSegment,
  playerIndex,
  setPlayerIndex,
  onSegmentEnded,
  onPlayFromSegment,
  onToggleSegmentFlag,
}) => {
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const flaggedCount = segments.filter((segment) => segment.flagged).length;
  const visibleSegments = showFlaggedOnly ? segments.filter((segment) => segment.flagged) : segments;

  return (
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>Audio Verification</h2>
          <p>Generate TTS, confirm verified output, then concat.</p>
        </div>
      </div>
      <div className="panel">
        <h3>Final M4A</h3>
        {finalAudioExists ? (
          <>
            <audio controls src={assetUrl(slug, finalAudioPath)} />
            <div className="button-row">
              <a className="button secondary" href={assetUrl(slug, finalAudioPath)} download={`${slug}-final.m4a`}>
                <Download size={16} aria-hidden="true" />
                Download final M4A
              </a>
              <button
                className="button secondary"
                type="button"
                title="Reveal the final audio file in Finder"
                onClick={onRevealFinalAudio}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Reveal in Finder
              </button>
            </div>
          </>
        ) : (
          <p>Final audio will appear after concat.</p>
        )}
      </div>

      <div className="button-row">
        <button
          className="button secondary"
          type="button"
          onClick={() => onStartJob('generate_verify_tts')}
          disabled={!canGenerate}
        >
          <AudioLines size={16} aria-hidden="true" />
          Generate + verify TTS
        </button>
        <button className="button secondary" type="button" onClick={onConfirmVerifiedAudio} disabled={!canConfirmVerified}>
          <Check size={16} aria-hidden="true" />
          Confirm verified output
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => onStartJob('concat_audio')}
          disabled={!canConcat}
        >
          <Play size={16} aria-hidden="true" />
          Concat final WAV
        </button>
        <button className="button" type="button" onClick={onApproveFinalAudio} disabled={!finalAudioExists}>
          <Check size={16} aria-hidden="true" />
          Approve final audio
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!canGenerate || regenSelection.size === 0}
          title="Regenerate every checked segment in one job"
          onClick={() => {
            const ids = [...regenSelection].sort();
            onClearRegenSelection();
            onStartJob('generate_verify_tts', ids);
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Regenerate selected ({regenSelection.size})
        </button>
      </div>

      <StoryPlayer
        slug={slug}
        playableSegments={playableSegments}
        playingSegment={playingSegment}
        playerIndex={playerIndex}
        setPlayerIndex={setPlayerIndex}
        onSegmentEnded={onSegmentEnded}
      />

      <div className="button-row">
        <button
          className={showFlaggedOnly ? 'button' : 'button secondary'}
          type="button"
          onClick={() => setShowFlaggedOnly((current) => !current)}
          disabled={!showFlaggedOnly && flaggedCount === 0}
        >
          <Flag size={16} aria-hidden="true" />
          {showFlaggedOnly ? 'Show all segments' : `Show flagged only (${flaggedCount})`}
        </button>
      </div>

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th />
            <th>ID</th>
            <th>Speaker</th>
            <th>Verification</th>
            <th>Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleSegments.length === 0 ? (
            <tr>
              <td colSpan={7} className="label">
                No flagged segments.
              </td>
            </tr>
          ) : null}
          {visibleSegments.map((segment) => (
            <tr key={segment.id} className={segment.flagged ? 'row-flagged' : undefined}>
              <td>
                <button
                  className="button secondary"
                  type="button"
                  title={segment.flagged ? 'Unflag this segment' : 'Flag this segment for review'}
                  aria-pressed={segment.flagged}
                  onClick={() => onToggleSegmentFlag(segment.id)}
                >
                  <Flag
                    size={15}
                    aria-hidden="true"
                    fill={segment.flagged ? 'currentColor' : 'none'}
                  />
                </button>
              </td>
              <td>
                {segment.status !== 'skipped' ? (
                  <input
                    type="checkbox"
                    checked={regenSelection.has(segment.id)}
                    onChange={() => onToggleRegenSelection(segment.id)}
                    aria-label={`Select segment ${segment.id} for regeneration`}
                  />
                ) : null}
              </td>
              <td className="mono">
                {playingSegment?.id === segment.id ? '▶ ' : ''}
                {segment.id}
              </td>
              <td>{segment.speakerId}</td>
              <td>
                <span
                  className={
                    segment.verification.status === 'passed'
                      ? 'badge good'
                      : segment.verification.status === 'failed' || segment.verification.status === 'max_attempts_reached'
                        ? 'badge bad'
                        : 'badge warn'
                  }
                >
                  {segment.verification.status}
                </span>
                <div className="label">attempts {segment.verification.attempts}</div>
              </td>
              <td>
                {segment.status === 'complete' || segment.verification.status === 'passed' ? (
                  <AudioDurationCell src={assetUrl(slug, segmentAudioPath(segment))} />
                ) : (
                  <span className="label">No audio</span>
                )}
              </td>
              <td>
                {segment.status !== 'skipped' ? (
                  <div className="button-row">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!playableSegments.some((candidate) => candidate.id === segment.id)}
                      title="Play the story from this segment onward"
                      onClick={() => onPlayFromSegment(segment.id)}
                    >
                      <Play size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canGenerate}
                      title={canGenerate ? `Regenerate and verify segment ${segment.id} only` : 'Approve segments and assign voices first'}
                      onClick={() => onStartJob('generate_verify_tts', [segment.id])}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      Regenerate
                    </button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
};

export default AudioTab;
