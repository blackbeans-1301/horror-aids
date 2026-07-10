import { AudioLines, Check, Play, Save, Wand2 } from 'lucide-react';
import React from 'react';

import type { ApprovalStatus, JobType } from '@/types/story';

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
  onSaveStory: () => void;
  onStartJob: (type: JobType) => void;
  onConfirmVerifiedAudio: () => void;
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
  onSaveStory,
  onStartJob,
  onConfirmVerifiedAudio,
}) => {
  return (
    <section className="grid">
      <div className="panel">
        <h2>Pipeline</h2>
        <p>Segment approval unlocks TTS. Whisper verification unlocks user validation. User validation unlocks concat.</p>
        <div className="status-line">
          <span className={storyText.trim() ? 'badge good' : 'badge warn'}>story</span>
          <span className={hasSegments ? 'badge good' : 'badge warn'}>segments</span>
          <span className={segmentApproval === 'approved' ? 'badge good' : 'badge warn'}>approved</span>
          <span className={allVerified ? 'badge good' : 'badge warn'}>verified</span>
          <span className={verifiedApproval === 'approved' ? 'badge good' : 'badge warn'}>confirmed</span>
          <span className={finalAudioExists ? 'badge good' : 'badge warn'}>final wav</span>
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
        </div>
      </div>
    </section>
  );
};

export default OverviewTab;
