import { AudioLines, Check, Play, RefreshCw, Save, Wand2 } from 'lucide-react';
import React from 'react';

import { formatLongDuration } from '@/features/stories/utils/format';
import type { ApprovalStatus, JobType } from '@/types/story';

// Measured from real runs: ~115 words of TTS input produces ~30s of audio,
// and generating+verifying that 30s of audio takes ~20s of wall-clock time.
const WORDS_PER_AUDIO_SECOND = 115 / 30;
const GENERATE_SECONDS_PER_AUDIO_SECOND = 20 / 30;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

interface OverviewTabProps {
  storyText: string;
  hasSegments: boolean;
  segmentApproval: ApprovalStatus;
  allVerified: boolean;
  verifiedApproval: ApprovalStatus;
  finalAudioExists: boolean;
  isBusy: boolean;
  canProcess: boolean;
  canGenerate: boolean;
  canConfirmVerified: boolean;
  canConcat: boolean;
  sourceContentId: string | null;
  onSaveStory: () => void;
  onStartJob: (type: JobType) => void;
  onConfirmVerifiedAudio: () => void;
  onSyncFromLibrary: () => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  storyText,
  hasSegments,
  segmentApproval,
  allVerified,
  verifiedApproval,
  finalAudioExists,
  isBusy,
  canProcess,
  canGenerate,
  canConfirmVerified,
  canConcat,
  sourceContentId,
  onSaveStory,
  onStartJob,
  onConfirmVerifiedAudio,
  onSyncFromLibrary,
}) => {
  const wordCount = countWords(storyText);
  const estimatedAudioMs = (wordCount / WORDS_PER_AUDIO_SECOND) * 1000;
  const estimatedGenerateMs = estimatedAudioMs * GENERATE_SECONDS_PER_AUDIO_SECOND;

  return (
    <section className="grid">
      <div className="panel">
        <h2>Story stats</h2>
        <p>Estimates based on ~{Math.round(WORDS_PER_AUDIO_SECOND * 30)} words per 30s of audio, ~20s generate time per 30s of audio.</p>
        <div className="settings-grid">
          <div className="panel">
            <div className="label">Word count</div>
            <h3>{wordCount.toLocaleString()}</h3>
          </div>
          <div className="panel">
            <div className="label">Estimated audio length</div>
            <h3>{formatLongDuration(estimatedAudioMs)}</h3>
          </div>
          <div className="panel">
            <div className="label">Estimated generate time</div>
            <h3>{formatLongDuration(estimatedGenerateMs)}</h3>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Pipeline</h2>
        <p>Segment approval unlocks TTS. Whisper verification unlocks user validation. User validation unlocks concat.</p>
        <div className="status-line">
          <span className={storyText.trim() ? 'badge good' : 'badge warn'}>story</span>
          <span className={hasSegments ? 'badge good' : 'badge warn'}>segments</span>
          <span className={segmentApproval === 'approved' ? 'badge good' : 'badge warn'}>approved</span>
          <span className={allVerified ? 'badge good' : 'badge warn'}>verified</span>
          <span className={verifiedApproval === 'approved' ? 'badge good' : 'badge warn'}>confirmed</span>
          <span className={finalAudioExists ? 'badge good' : 'badge warn'}>final m4a</span>
        </div>
      </div>
      <div className="panel">
        <h2>Quick Actions</h2>
        <div className="button-row">
          <button className="button secondary" type="button" onClick={onSaveStory} disabled={isBusy}>
            <Save size={16} aria-hidden="true" />
            Save story
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!canProcess}
            onClick={() => onStartJob('process_story')}
          >
            <Wand2 size={16} aria-hidden="true" />
            Process story
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!canGenerate}
            onClick={() => onStartJob('generate_verify_tts')}
          >
            <AudioLines size={16} aria-hidden="true" />
            Generate + verify
          </button>
          <button className="button secondary" type="button" disabled={!canConfirmVerified} onClick={onConfirmVerifiedAudio}>
            <Check size={16} aria-hidden="true" />
            Confirm verified output
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!canConcat}
            onClick={() => onStartJob('concat_audio')}
          >
            <Play size={16} aria-hidden="true" />
            Concat final WAV
          </button>
          {sourceContentId ? (
            <button className="button secondary" type="button" disabled={isBusy} onClick={onSyncFromLibrary}>
              <RefreshCw size={16} aria-hidden="true" />
              Đồng bộ lại từ Thư viện
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default OverviewTab;
