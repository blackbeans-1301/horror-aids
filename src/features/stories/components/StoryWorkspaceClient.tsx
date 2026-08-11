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
import React from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
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
    canApproveMetadata,
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
    uploadIntroImage,
    deleteIntroImage,
    approveFinalVideo,
    revealFinalVideo,
    selectVideoRender,
    deleteVideoRender,
    updateYoutubeMetadata,
    saveYoutubeMetadata,
    generateYoutubeMetadata,
    approveYoutubeMetadata,
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

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">Story Workspace</div>
            <h1>{detail?.story.title ?? slug}</h1>
            <p className="status-line">
              <span className="badge">{detail?.story.status ?? 'loading'}</span>
              <span className="badge">segments {segmentApproval}</span>
              <span className={allVerified ? 'badge good' : 'badge warn'}>
                verified {allVerified ? 'passed' : 'pending'}
              </span>
              <span className="badge">final audio {detail?.story.approvals.finalAudio.status ?? 'pending'}</span>
              <span className="badge">final video {detail?.story.approvals.finalVideo.status ?? 'pending'}</span>
              <span className="badge">metadata {detail?.story.approvals.metadata.status ?? 'pending'}</span>
            </p>
          </div>
          <div className="button-row">
            <Link className="button secondary" href="/">
              Back
            </Link>
          </div>
        </div>

        {loadError ? <p className="panel">{loadError}</p> : null}

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
            <button
              className={activeTab === tab.id ? 'tab active' : 'tab'}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
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
            onUploadIntroImage={(file) => void uploadIntroImage(file)}
            onDeleteIntroImage={() => void deleteIntroImage()}
            onStartRender={() => void handleStartJob('render_video')}
            onApproveFinalVideo={() => void approveFinalVideo()}
            onRevealFinalVideo={() => void revealFinalVideo()}
            onSelectRender={(jobId) => void selectVideoRender(jobId)}
            onDeleteRender={(jobId) => void deleteVideoRender(jobId)}
          />
        ) : null}

        {activeTab === 'metadata' ? (
          <MetadataTab
            metadata={youtubeMetadata}
            isDirty={dirty.youtubeMetadata}
            isBusy={effectiveBusy}
            canGenerate={canGenerateMetadata}
            canApprove={canApproveMetadata}
            metadataApprovalStatus={detail?.story.approvals.metadata.status ?? 'pending'}
            onUpdate={updateYoutubeMetadata}
            onSave={() => void saveYoutubeMetadata()}
            onGenerate={() => void generateYoutubeMetadata()}
            onApprove={() => void approveYoutubeMetadata()}
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
