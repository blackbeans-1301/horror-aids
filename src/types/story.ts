export type StoryStatus =
  | 'story_draft'
  | 'processed'
  | 'segments_review'
  | 'segments_approved'
  | 'tts_running'
  | 'tts_verified'
  | 'audio_validation'
  | 'ready_to_concat'
  | 'audio_complete'
  | 'video_complete'
  | 'failed';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RightsStatus =
  | 'original'
  | 'permission_recorded'
  | 'reference_only'
  | 'risk_acknowledged';

export type SourceType =
  | 'manual'
  | 'generated_later'
  | 'reddit_reference_later'
  | 'reddit_import_later'
  | 'library_import';

export type CharacterRole =
  | 'narrator'
  | 'main_character'
  | 'side_character'
  | 'villain'
  | 'other';

export type SegmentStatus =
  | 'pending'
  | 'ready'
  | 'generating'
  | 'complete'
  | 'verification_failed'
  | 'failed'
  | 'skipped';

export type VerificationStatus =
  | 'pending'
  | 'transcribing'
  | 'passed'
  | 'failed'
  | 'max_attempts_reached';

export type JobType = 'process_story' | 'generate_verify_tts' | 'concat_audio' | 'render_video';

export type JobStatus =
  | 'pending'
  | 'running'
  | 'needs_review'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface StoryIndexEntry {
  id: string;
  title: string;
  status: StoryStatus;
  language: string;
  sourceType: SourceType;
  storyPath: string;
  updatedAt: string;
  archived: boolean;
  archivedAt: string | null;
  sourceContentId: string | null;
}

export interface StoryIndex {
  stories: StoryIndexEntry[];
}

export interface StoryRecord {
  id: string;
  title: string;
  language: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  rightsStatus: RightsStatus;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  archivedAt: string | null;
  // Folder id (in the content/horror-stories submodule) this workspace was imported from.
  // null for stories created manually inside this app.
  sourceContentId: string | null;
  text: {
    storyPath: string;
    charactersPath: string;
    segmentsPath: string;
  };
  approvals: {
    segments: {
      status: ApprovalStatus;
      approvedAt: string | null;
    };
    verifiedAudio: {
      status: ApprovalStatus;
      approvedAt: string | null;
    };
    finalAudio: {
      status: ApprovalStatus;
      approvedAt: string | null;
    };
    finalVideo: {
      status: ApprovalStatus;
      approvedAt: string | null;
    };
  };
  audio: {
    segmentsDir: string;
    finalPath: string;
    status: 'pending' | 'running' | 'verified' | 'complete' | 'failed';
  };
  video: {
    planPath: string;
    finalPath: string;
    status: 'pending' | 'running' | 'complete' | 'failed';
    durationMs: number | null;
    renderedAt: string | null;
  };
}

export interface CharacterRecord {
  id: string;
  name: string;
  role: CharacterRole;
  voice: string;
}

export interface CharactersFile {
  characters: CharacterRecord[];
}

export interface SegmentVerification {
  status: VerificationStatus;
  attempts: number;
  lastError: string | null;
  transcriptPreview: string | null;
}

export type SegmentEmotion = 'natural' | 'storytelling';

export interface SegmentRecord {
  id: string;
  order: number;
  speakerId: string;
  text: string;
  emotion: SegmentEmotion;
  audioPath: string;
  whisperTranscriptPath: string;
  status: SegmentStatus;
  verification: SegmentVerification;
  flagged: boolean;
}

export interface SegmentsFile {
  segments: SegmentRecord[];
}

export interface JobRecord {
  id: string;
  storyId: string;
  type: JobType;
  status: JobStatus;
  pid: number | null;
  startedAt: string;
  finishedAt: string | null;
  logPath: string;
  resultPath: string;
  command: string[];
  error: string | null;
}

export interface JobsFile {
  jobs: JobRecord[];
}

export interface VoiceRecord {
  id: string;
  name: string;
  wavPath: string;
  createdAt: string;
}

export interface VoicesFile {
  voices: VoiceRecord[];
}

export type MediaCategory = 'bg_music' | 'rain_ambience' | 'intro_music' | 'scene_video';

export interface MediaAssetBase {
  id: string;
  category: MediaCategory;
  name: string;
  // Project-root-relative POSIX path, same shape as VoiceRecord.wavPath.
  path: string;
  loopable: boolean;
  durationMs: number | null;
  source: string;
  notes: string;
  addedAt: string;
}

export interface AudioMediaAsset extends MediaAssetBase {
  category: 'bg_music' | 'rain_ambience' | 'intro_music';
  // EBU R128 integrated loudness measured at ingest; null when ffmpeg was unavailable.
  integratedLufs: number | null;
  defaultGainDb: number;
}

export interface VideoMediaAsset extends MediaAssetBase {
  category: 'scene_video';
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudioStream: boolean;
}

export type MediaAsset = AudioMediaAsset | VideoMediaAsset;

export interface MediaLibraryFile {
  schemaVersion: number;
  media: MediaAsset[];
}

export interface VideoPlanFile {
  schemaVersion: number;
  // Story-relative path to the operator's uploaded intro image; null until uploaded.
  introImagePath: string | null;
  introMusicId: string | null;
  introDurationMs: number;
  introMusicGainDb: number;
  sceneVideoId: string | null;
  bgMusicId: string | null;
  bgMusicGainDb: number;
  rainAmbienceId: string | null;
  rainAmbienceGainDb: number;
  leadInMs: number;
  tailOutMs: number;
  transitionMs: number;
  duckingEnabled: boolean;
  updatedAt: string;
}

export interface VideoRenderReceiptAsset {
  role: 'scene_video' | 'bg_music' | 'rain_ambience' | 'intro_music' | 'intro_image';
  id: string | null;
  path: string;
  source: string;
  appliedGainDb: number | null;
}

export interface VideoRenderReceipt {
  jobId: string;
  renderedAt: string;
  outputPath: string;
  durationMs: number;
  introDurationMs: number;
  narrationDurationMs: number;
  width: number;
  height: number;
  fps: number;
  encoder: string;
  loudnessTargetLufs: number;
  assets: VideoRenderReceiptAsset[];
  // Full plan snapshot at render time — lets a later "which config produced
  // this?" question be answered without guessing.
  plan: VideoPlanFile;
}

// One entry per past render job, read back from stories/[slug]/video/renders/
// — each render is kept (never overwritten), so switching plan settings and
// re-rendering to compare no longer clobbers the previous attempt.
export interface VideoRenderSummary {
  jobId: string;
  path: string;
  renderedAt: string;
  durationMs: number;
  // Whether story.video.finalPath currently points at this render.
  isCurrent: boolean;
  // isCurrent && approvals.finalVideo.status === 'approved'.
  isApproved: boolean;
  plan: VideoPlanFile;
}

export interface JobTypeAnalytics {
  type: JobType;
  runs: number;
  completedRuns: number;
  totalDurationMs: number;
  averageDurationMs: number | null;
  lastFinishedAt: string | null;
}

export interface StoryAnalytics {
  createdAt: string;
  segmentsApprovedAt: string | null;
  verifiedAudioApprovedAt: string | null;
  finalAudioApprovedAt: string | null;
  totalDurationMs: number;
  isComplete: boolean;
  phaseDurationsMs: {
    draftToSegmentsApproved: number | null;
    segmentsApprovedToVerified: number | null;
    verifiedToFinalApproved: number | null;
  };
  jobs: JobTypeAnalytics[];
}

export interface StoryDetail {
  story: StoryRecord;
  storyText: string;
  characters: CharactersFile;
  segments: SegmentsFile;
  activeJob: JobRecord | null;
  recentJobs: JobRecord[];
  finalAudioExists: boolean;
  videoPlan: VideoPlanFile;
  finalVideoExists: boolean;
  videoRenders: VideoRenderSummary[];
  analytics: StoryAnalytics;
}

// The only two values a human ever sets directly, before any workspace
// exists — 'processing'/'archived' are derived from the linked workspace's
// real state (see deriveStatus in src/lib/content-library.ts), never stored.
export type ContentStoryEditorialStatus = 'draft' | 'approved';

export type ContentStoryStatus = ContentStoryEditorialStatus | 'processing' | 'archived';

export interface ContentStoryEntry {
  id: string;
  title: string;
  status: ContentStoryStatus;
  chapterCount: number;
  updatedAt: string | null;
  linkedStorySlug: string | null;
}

export interface ContentStoryDocuments {
  bible: string | null;
  characters: string | null;
  outline: string | null;
  factDb: string | null;
  progress: string | null;
}

export interface ContentChapter {
  file: string;
  title: string;
  content: string;
}

export interface ContentStoryDetail extends ContentStoryEntry {
  documents: ContentStoryDocuments;
  chapters: ContentChapter[];
}
