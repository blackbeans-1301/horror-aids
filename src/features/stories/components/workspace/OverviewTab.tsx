import { AudioLines, Check, Play, RefreshCw, Save, Wand2 } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
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
    <section className="layout-grid">
      <Card>
        <CardTitle>Story stats</CardTitle>
        <p>Estimates based on ~{Math.round(WORDS_PER_AUDIO_SECOND * 30)} words per 30s of audio, ~20s generate time per 30s of audio.</p>
        <div className="settings-grid">
          <Card>
            <div className="label">Word count</div>
            <CardTitle>{wordCount.toLocaleString()}</CardTitle>
          </Card>
          <Card>
            <div className="label">Estimated audio length</div>
            <CardTitle>{formatLongDuration(estimatedAudioMs)}</CardTitle>
          </Card>
          <Card>
            <div className="label">Estimated generate time</div>
            <CardTitle>{formatLongDuration(estimatedGenerateMs)}</CardTitle>
          </Card>
        </div>
      </Card>
      <Card>
        <CardTitle>Pipeline</CardTitle>
        <p>Segment approval unlocks TTS. Whisper verification unlocks user validation. User validation unlocks concat.</p>
        <div className="status-line">
          <Badge variant={storyText.trim() ? 'good' : 'warn'}>story</Badge>
          <Badge variant={hasSegments ? 'good' : 'warn'}>segments</Badge>
          <Badge variant={segmentApproval === 'approved' ? 'good' : 'warn'}>approved</Badge>
          <Badge variant={allVerified ? 'good' : 'warn'}>verified</Badge>
          <Badge variant={verifiedApproval === 'approved' ? 'good' : 'warn'}>confirmed</Badge>
          <Badge variant={finalAudioExists ? 'good' : 'warn'}>final m4a</Badge>
        </div>
      </Card>
      <Card>
        <CardTitle>Quick Actions</CardTitle>
        <div className="button-row">
          <Button variant="secondary" type="button" onClick={onSaveStory} disabled={isBusy}>
            <Save size={16} aria-hidden="true" />
            Save story
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!canProcess}
            onClick={() => onStartJob('process_story')}
          >
            <Wand2 size={16} aria-hidden="true" />
            Process story
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!canGenerate}
            onClick={() => onStartJob('generate_verify_tts')}
          >
            <AudioLines size={16} aria-hidden="true" />
            Generate + verify
          </Button>
          <Button variant="secondary" type="button" disabled={!canConfirmVerified} onClick={onConfirmVerifiedAudio}>
            <Check size={16} aria-hidden="true" />
            Confirm verified output
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!canConcat}
            onClick={() => onStartJob('concat_audio')}
          >
            <Play size={16} aria-hidden="true" />
            Concat final WAV
          </Button>
          {sourceContentId ? (
            <Button variant="secondary" type="button" disabled={isBusy} onClick={onSyncFromLibrary}>
              <RefreshCw size={16} aria-hidden="true" />
              Đồng bộ lại từ Thư viện
            </Button>
          ) : null}
        </div>
      </Card>
    </section>
  );
};

export default OverviewTab;
