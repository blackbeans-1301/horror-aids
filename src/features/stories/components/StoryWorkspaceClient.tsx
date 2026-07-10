'use client';

import Link from 'next/link';
import { AudioLines, FileText, ListChecks, RefreshCw, Scissors, Terminal, Users } from 'lucide-react';
import React from 'react';

import { AppShell } from '@/features/stories/components/AppShell';
import { AudioTab } from '@/features/stories/components/workspace/AudioTab';
import { CharactersTab } from '@/features/stories/components/workspace/CharactersTab';
import { LogsTab } from '@/features/stories/components/workspace/LogsTab';
import { OverviewTab } from '@/features/stories/components/workspace/OverviewTab';
import { SegmentsTab } from '@/features/stories/components/workspace/SegmentsTab';
import { StoryTab } from '@/features/stories/components/workspace/StoryTab';
import { type TabId, useStoryWorkspace } from '@/features/stories/hooks/useStoryWorkspace';

interface StoryWorkspaceClientProps {
  slug: string;
}

const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <ListChecks size={15} aria-hidden="true" /> },
  { id: 'story', label: 'Story', icon: <FileText size={15} aria-hidden="true" /> },
  { id: 'characters', label: 'Characters', icon: <Users size={15} aria-hidden="true" /> },
  { id: 'segments', label: 'Segments', icon: <Scissors size={15} aria-hidden="true" /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={15} aria-hidden="true" /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={15} aria-hidden="true" /> },
];

export const StoryWorkspaceClient: React.FC<StoryWorkspaceClientProps> = ({ slug }) => {
  const workspace = useStoryWorkspace(slug);
  const {
    detail,
    loadError,
    activeTab,
    setActiveTab,
    storyText,
    setStoryText,
    characters,
    segments,
    selectedJob,
    jobLog,
    isBusy,
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
    canProcess,
    canGenerate,
    canConfirmVerified,
    canConcat,
    refresh,
    startJob,
    saveStory,
    saveCharacters,
    saveSegments,
    approveSegments,
    confirmVerifiedAudio,
    approveFinalAudio,
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
  } = workspace;

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
              <span className="badge">final {detail?.story.approvals.finalAudio.status ?? 'pending'}</span>
            </p>
          </div>
          <div className="button-row">
            <Link className="button secondary" href="/">
              Back
            </Link>
            <button className="button secondary" type="button" onClick={() => void refresh()}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        {loadError ? <p className="panel">{loadError}</p> : null}

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
            isBusy={isBusy}
            canProcess={canProcess}
            canGenerate={canGenerate}
            canConfirmVerified={canConfirmVerified}
            canConcat={canConcat}
            onSaveStory={() => void saveStory()}
            onStartJob={(type) => void startJob(type)}
            onConfirmVerifiedAudio={() => void confirmVerifiedAudio()}
          />
        ) : null}

        {activeTab === 'story' ? (
          <StoryTab
            storyText={storyText}
            onChangeStoryText={setStoryText}
            onSaveStory={() => void saveStory()}
            onProcessStory={() => void startJob('process_story')}
            isBusy={isBusy}
            canProcess={canProcess}
          />
        ) : null}

        {activeTab === 'characters' ? (
          <CharactersTab
            characters={characters}
            voices={voices}
            voicesError={voicesError}
            isBusy={isBusy}
            onUpdateCharacter={updateCharacter}
            onAddCharacter={addCharacter}
            onRemoveCharacter={removeCharacter}
            onSaveCharacters={() => void saveCharacters()}
          />
        ) : null}

        {activeTab === 'segments' ? (
          <SegmentsTab
            segments={segments}
            characters={characters}
            voicesReady={voicesReady}
            isBusy={isBusy}
            onUpdateSegment={updateSegment}
            onAddSegment={addSegment}
            onInsertSegmentAfter={insertSegmentAfter}
            onDeleteSegment={deleteSegment}
            onSplitSegment={splitSegment}
            onMergeWithNext={mergeWithNext}
            onSaveSegments={() => void saveSegments()}
            onApproveSegments={() => void approveSegments()}
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
            finalAudioPath={detail?.story.audio.finalPath ?? 'audio/final.wav'}
            regenSelection={regenSelection}
            onToggleRegenSelection={toggleRegenSelection}
            onStartJob={(type, segmentIds) => void startJob(type, segmentIds)}
            onClearRegenSelection={() => setRegenSelection(new Set())}
            onConfirmVerifiedAudio={() => void confirmVerifiedAudio()}
            onApproveFinalAudio={() => void approveFinalAudio()}
            playableSegments={playableSegments}
            playingSegment={playingSegment}
            playerIndex={playerIndex}
            setPlayerIndex={setPlayerIndex}
            onSegmentEnded={handleSegmentEnded}
            onPlayFromSegment={playFromSegment}
          />
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
