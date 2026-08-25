'use client';

import Link from 'next/link';
import {
  AudioLines,
  BarChart3,
  Clapperboard,
  FileText,
  ListChecks,
  Scissors,
  Terminal,
  Users,
  Youtube,
} from 'lucide-react';
import React, { useEffect } from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AppShell } from '@/features/stories/components/AppShell';
import { ActiveJobBanner } from '@/features/stories/components/workspace/ActiveJobBanner';
import { AnalyticsTab } from '@/features/stories/components/workspace/AnalyticsTab';
import { AudioTab } from '@/features/stories/components/workspace/AudioTab';
import { CharactersTab } from '@/features/stories/components/workspace/CharactersTab';
import { LogsTab } from '@/features/stories/components/workspace/LogsTab';
import { MetadataTab } from '@/features/stories/components/workspace/MetadataTab';
import { OverviewTab } from '@/features/stories/components/workspace/OverviewTab';
import { SegmentsTab } from '@/features/stories/components/workspace/SegmentsTab';
import { StoryTab } from '@/features/stories/components/workspace/StoryTab';
import { VideoTab } from '@/features/stories/components/workspace/VideoTab';
import { type TabId, useStoryWorkspace } from '@/features/stories/hooks/useStoryWorkspace';
import type { JobType } from '@/types/story';

interface StoryWorkspaceClientProps {
  slug: string;
}

const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <ListChecks size={15} aria-hidden="true" /> },
  { id: 'story', label: 'Story', icon: <FileText size={15} aria-hidden="true" /> },
  { id: 'characters', label: 'Characters', icon: <Users size={15} aria-hidden="true" /> },
  { id: 'segments', label: 'Segments', icon: <Scissors size={15} aria-hidden="true" /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={15} aria-hidden="true" /> },
  { id: 'video', label: 'Video', icon: <Clapperboard size={15} aria-hidden="true" /> },
  { id: 'metadata', label: 'Metadata', icon: <Youtube size={15} aria-hidden="true" /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={15} aria-hidden="true" /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={15} aria-hidden="true" /> },
];

export const StoryWorkspaceClient: React.FC<StoryWorkspaceClientProps> = ({ slug }) => {
  const workspace = useStoryWorkspace(slug);
  const confirm = useConfirm();
  const {
    detail,
    loadError,
    activeTab,
    setActiveTab,
    storyText,
    setStoryText,
    characters,
    segments,
    videoPlan,
    videoRenders,
    youtubeMetadata,
    selectedJob,
    jobLog,
    isBusy,
    dirty,
    clearDirty,
    voices,
    voicesError,
    regenSelection,
    toggleRegenSelection,
    setRegenSelection,
    playerIndex,
    setPlayerIndex,
    playableSegments,
    playingSegment,
    playFromSegment,
    handleSegmentEnded,
    voicesReady,
    allVerified,
    segmentApproval,
    verifiedApproval,
    hasActiveJob,
    isArchived,
    canProcess,
    canGenerate,
    canConfirmVerified,
    canConcat,
    canRenderVideo,
    canGenerateMetadata,
    startJob,
    stopJob,
    saveStory,
    saveCharacters,
    saveSegments,
    approveSegments,
    confirmVerifiedAudio,
    approveFinalAudio,
    revealFinalAudio,
    updateVideoPlan,
    saveVideoPlan,
    randomizeVideoPlan,
    resetVideoPlanGain,
    uploadIntroImage,
    deleteIntroImage,
    revealIntroImage,
    approveFinalVideo,
    revealFinalVideo,
    selectVideoRender,
    deleteVideoRender,
    updateYoutubeMetadata,
    generateYoutubeMetadata,
    syncFromLibrary,
    loadJobLog,
    updateCharacter,
    addCharacter,
    removeCharacter,
    updateSegment,
    addSegment,
    insertSegmentAfter,
    deleteSegment,
    splitSegment,
    mergeWithNext,
    toggleSegmentFlag,
    selectSegmentTake,
  } = workspace;

  // Land on a specific tab when opened from the job queue sidebar's "View" —
  // e.g. /stories/<slug>?tab=video after a render_video job finishes.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && tabs.some((tab) => tab.id === requested)) {
      setActiveTab(requested as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save/Process/Generate are already gated server-side for archived
  // stories; fold the same guard into the shared busy flag so the buttons
  // show as unavailable client-side too, instead of a generic error toast.
  const effectiveBusy = isBusy || isArchived;

  // process_story rebuilds segments.json from the raw story text — any
  // manual splits/merges/speaker changes made in the Segments tab are
  // discarded, approved or not. Confirm before throwing that work away.
  const handleProcessStory = async (): Promise<void> => {
    if (segments.length > 0) {
      const confirmed = await confirm({
        title: 'Re-process story?',
        description:
          `This discards the current ${segments.length} segment(s) — including any manual ` +
          'edits, splits, merges, or speaker changes — and rebuilds them from the story text. ' +
          'This cannot be undone.',
        confirmLabel: 'Discard and reprocess',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      // The job is about to overwrite segments.json wholesale; drop any
      // stale local edit flag now so the next poll adopts the fresh server
      // data instead of a "Save segments" later clobbering it back.
      clearDirty('segments');
    }
    // process_story reads story.md from disk — save unsaved text first so it
    // processes what's on screen, not the last-saved version.
    if (dirty.story) {
      await saveStory();
    }
    await startJob('process_story');
  };

  // generate_verify_tts reads characters.json/segments.json from disk —
  // save unsaved edits first so it synthesizes the text/voice actually shown
  // on screen instead of silently using stale saved content.
  const handleStartJob = async (type: JobType, segmentIds?: string[]): Promise<void> => {
    if (type === 'process_story') {
      await handleProcessStory();
      return;
    }
    if (type === 'render_video') {
      // render_video reads video/plan.json from disk — save unsaved edits
      // first so it renders the picks actually shown on screen.
      if (dirty.videoPlan) {
        await saveVideoPlan();
      }
    }
    if (type === 'generate_verify_tts') {
      if (dirty.characters) {
        await saveCharacters();
      }
      if (dirty.segments) {
        await saveSegments();
      }
    }
    await startJob(type, segmentIds);
  };

  // Overwrites story text with the latest from the writing library and
  // resets all approvals to pending (see writeStoryText) — confirm first,
  // same danger-confirm shape as re-processing a story.
  const handleSyncFromLibrary = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Đồng bộ lại từ Thư viện?',
      description:
        'Ghi đè nội dung truyện bằng bản mới nhất từ Thư viện và reset toàn bộ tiến độ duyệt ' +
        '(segments, verified audio, final audio) về pending. Không thể hoàn tác.',
      confirmLabel: 'Đồng bộ và reset',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    await syncFromLibrary();
  };

  // Deleting the render currently pointed at (approved or not) clears the
  // story's final video selection and resets the finalVideo approval — same
  // danger-confirm shape as the other actions above that discard approved
  // progress.
  const handleDeleteRender = async (jobId: string): Promise<void> => {
    const render = videoRenders.find((entry) => entry.jobId === jobId);
    if (render?.isCurrent) {
      const confirmed = await confirm({
        title: 'Xoá bản render đang dùng?',
        description: render.isApproved
          ? 'Bản render này đã được duyệt. Xoá sẽ bỏ chọn video hiện tại và reset trạng thái duyệt ' +
            'video cuối về pending. Không thể hoàn tác.'
          : 'Đây là bản render đang được chọn làm video cuối. Xoá sẽ bỏ chọn video hiện tại. ' +
            'Không thể hoàn tác.',
        confirmLabel: 'Xoá bản render',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    await deleteVideoRender(jobId);
  };

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">Story Workspace</div>
            <h1>{detail?.story.title ?? slug}</h1>
            <p className="status-line">
              <Badge>{detail?.story.status ?? 'loading'}</Badge>
              <Badge>segments {segmentApproval}</Badge>
              <Badge variant={allVerified ? 'good' : 'warn'}>verified {allVerified ? 'passed' : 'pending'}</Badge>
              <Badge>final audio {detail?.story.approvals.finalAudio.status ?? 'pending'}</Badge>
              <Badge>final video {detail?.story.approvals.finalVideo.status ?? 'pending'}</Badge>
            </p>
          </div>
          <div className="button-row">
            <Button asChild variant="secondary">
              <Link href="/">Back</Link>
            </Button>
          </div>
        </div>

        {loadError ? (
          <Card>
            <p>{loadError}</p>
          </Card>
        ) : null}

        {isArchived ? (
          <p className="status-banner">
            This story is archived — unarchive it from the dashboard before saving or running
            jobs.
          </p>
        ) : null}

        {detail?.activeJob ? (
          <ActiveJobBanner
            job={detail.activeJob}
            onViewLog={() => setActiveTab('logs')}
            onStop={() => void stopJob()}
            isStopping={isBusy}
          />
        ) : null}

        <div className="tabs">
          {tabs.map((tab) => (
            <Button
              variant={activeTab === tab.id ? undefined : 'secondary'}
              size="sm"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.icon}
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <OverviewTab
            storyText={storyText}
            hasSegments={segments.length > 0}
            segmentApproval={segmentApproval}
            allVerified={allVerified}
            verifiedApproval={verifiedApproval}
            finalAudioExists={detail?.finalAudioExists ?? false}
            isBusy={effectiveBusy}
            canProcess={canProcess}
            canGenerate={canGenerate}
            canConfirmVerified={canConfirmVerified}
            canConcat={canConcat}
            sourceContentId={detail?.story.sourceContentId ?? null}
            onSaveStory={() => void saveStory()}
            onStartJob={(type) => void handleStartJob(type)}
            onConfirmVerifiedAudio={() => void confirmVerifiedAudio()}
            onSyncFromLibrary={() => void handleSyncFromLibrary()}
          />
        ) : null}

        {activeTab === 'story' ? (
          <StoryTab
            storyText={storyText}
            onChangeStoryText={setStoryText}
            onSaveStory={() => void saveStory()}
            onProcessStory={() => void handleProcessStory()}
            isBusy={effectiveBusy}
            canProcess={canProcess}
            isDirty={dirty.story}
          />
        ) : null}

        {activeTab === 'characters' ? (
          <CharactersTab
            characters={characters}
            voices={voices}
            voicesError={voicesError}
            isBusy={effectiveBusy}
            onUpdateCharacter={updateCharacter}
            onAddCharacter={addCharacter}
            onRemoveCharacter={removeCharacter}
            onSaveCharacters={() => void saveCharacters()}
            isDirty={dirty.characters}
          />
        ) : null}

        {activeTab === 'segments' ? (
          <SegmentsTab
            segments={segments}
            characters={characters}
            voicesReady={voicesReady}
            isBusy={effectiveBusy}
            hasActiveJob={hasActiveJob}
            onUpdateSegment={updateSegment}
            onAddSegment={addSegment}
            onInsertSegmentAfter={insertSegmentAfter}
            onDeleteSegment={deleteSegment}
            onSplitSegment={splitSegment}
            onMergeWithNext={mergeWithNext}
            onSaveSegments={() => void saveSegments()}
            onApproveSegments={() => void approveSegments()}
            isDirty={dirty.segments}
          />
        ) : null}

        {activeTab === 'audio' ? (
          <AudioTab
            slug={slug}
            segments={segments}
            canGenerate={canGenerate}
            canConfirmVerified={canConfirmVerified}
            canConcat={canConcat}
            finalAudioExists={detail?.finalAudioExists ?? false}
            finalAudioPath={detail?.story.audio.finalPath ?? 'audio/final.m4a'}
            regenSelection={regenSelection}
            onToggleRegenSelection={toggleRegenSelection}
            onStartJob={(type, segmentIds) => void handleStartJob(type, segmentIds)}
            onClearRegenSelection={() => setRegenSelection(new Set())}
            onConfirmVerifiedAudio={() => void confirmVerifiedAudio()}
            onApproveFinalAudio={() => void approveFinalAudio()}
            onRevealFinalAudio={() => void revealFinalAudio()}
            playableSegments={playableSegments}
            playingSegment={playingSegment}
            playerIndex={playerIndex}
            setPlayerIndex={setPlayerIndex}
            onSegmentEnded={handleSegmentEnded}
            onPlayFromSegment={playFromSegment}
            onToggleSegmentFlag={(segmentId) => void toggleSegmentFlag(segmentId)}
            onSelectSegmentTake={(segmentId) => void selectSegmentTake(segmentId)}
          />
        ) : null}

        {activeTab === 'video' ? (
          <VideoTab
            slug={slug}
            videoPlan={videoPlan}
            videoRenders={videoRenders}
            isDirty={dirty.videoPlan}
            isBusy={effectiveBusy}
            canRenderVideo={canRenderVideo}
            finalVideoExists={detail?.finalVideoExists ?? false}
            finalVideoPath={detail?.story.video.finalPath ?? 'video/final.mp4'}
            onUpdatePlan={updateVideoPlan}
            onSavePlan={() => void saveVideoPlan()}
            onRandomize={() => void randomizeVideoPlan()}
            onResetGain={() => void resetVideoPlanGain()}
            onUploadIntroImage={(file) => void uploadIntroImage(file)}
            onDeleteIntroImage={() => void deleteIntroImage()}
            onRevealIntroImage={() => void revealIntroImage()}
            onStartRender={() => void handleStartJob('render_video')}
            onApproveFinalVideo={() => void approveFinalVideo()}
            onRevealFinalVideo={() => void revealFinalVideo()}
            onSelectRender={(jobId) => void selectVideoRender(jobId)}
            onDeleteRender={(jobId) => void handleDeleteRender(jobId)}
          />
        ) : null}

        {activeTab === 'metadata' ? (
          <MetadataTab
            metadata={youtubeMetadata}
            isDirty={dirty.youtubeMetadata}
            isBusy={effectiveBusy}
            canGenerate={canGenerateMetadata}
            onUpdate={updateYoutubeMetadata}
            onGenerate={() => void generateYoutubeMetadata()}
            onGenerateField={(field) => void generateYoutubeMetadata([field])}
          />
        ) : null}

        {activeTab === 'analytics' && detail ? (
          <AnalyticsTab analytics={detail.analytics} segments={segments} />
        ) : null}

        {activeTab === 'logs' ? (
          <LogsTab
            jobs={detail?.recentJobs ?? []}
            selectedJob={selectedJob}
            jobLog={jobLog}
            onSelectJob={(jobId) => void loadJobLog(jobId)}
          />
        ) : null}
      </main>
    </AppShell>
  );
};

export default StoryWorkspaceClient;
