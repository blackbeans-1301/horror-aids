import { AudioLines, Check, Play, RefreshCw, Save, Wand2 } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { formatLongDuration } from '@/features/stories/utils/format';
import { libraryApi } from '@/features/library/api/libraryApi';
import type { ApprovalStatus, ContentStoryDocuments, JobType } from '@/types/story';

// Measured from real runs: ~115 words of TTS input produces ~30s of audio,
// and generating+verifying that 30s of audio takes ~20s of wall-clock time.
const WORDS_PER_AUDIO_SECOND = 115 / 30;
const GENERATE_SECONDS_PER_AUDIO_SECOND = 20 / 30;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Truyện nhập từ Thư viện truyện có Bible.md / Outline_Timeline.md riêng ở
// đó — không copy vào workspace, nên phải fetch lại từ Thư viện mỗi khi mở
// tab này (xem src/lib/content-library.ts::readDocuments).
function useSourceDocuments(sourceContentId: string | null): ContentStoryDocuments | null {
  const [documents, setDocuments] = useState<ContentStoryDocuments | null>(null);

  useEffect(() => {
    if (!sourceContentId) {
      setDocuments(null);
      return;
    }
    let cancelled = false;
    void libraryApi
      .detail(sourceContentId)
      .then((detail) => {
        if (!cancelled) {
          setDocuments(detail.documents);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocuments(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceContentId]);

  return documents;
}

const SourceDoc: React.FC<{ title: string; content: string | null; emptyLabel: string }> = ({
  title,
  content,
  emptyLabel,
}) => (
  <Card>
    <CardTitle>{title}</CardTitle>
    {content ? (
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    ) : (
      <p className="label">{emptyLabel}</p>
    )}
  </Card>
);

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
  const sourceDocuments = useSourceDocuments(sourceContentId);

  return (
    <section className="layout-grid">
      {sourceContentId ? (
        <>
          <div className="page-header span-2">
            <div>
              <h2>Bible &amp; Outline (từ Thư viện truyện)</h2>
              <p>
                Truyện này được nhập từ Thư viện truyện — tóm tắt bối cảnh, nhân vật, cốt truyện xem
                đầy đủ ở <Link href={`/library/${sourceContentId}`}>trang Thư viện</Link>.
              </p>
            </div>
          </div>
          <div className="span-2">
            <SourceDoc
              title="Bible"
              content={sourceDocuments?.bible ?? null}
              emptyLabel="Truyện này chưa có Bible.md."
            />
          </div>
          <div className="span-2">
            <SourceDoc
              title="Outline & Timeline"
              content={sourceDocuments?.outline ?? null}
              emptyLabel="Truyện này chưa có Outline_Timeline.md."
            />
          </div>
        </>
      ) : null}
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
