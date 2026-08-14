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
  | 'metadata_ready'
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
    metadata: {
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
  metadata: {
    path: string;
    status: 'pending' | 'generated' | 'failed';
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

// The one older take (path + verification snapshot from before it was
// superseded) kept alongside the current audioPath — see
// generate_verify_tts.py's take versioning, which never overwrites the
// current file in place, so a regeneration that sounds worse can be
// switched back from instead of only ever being lost.
export interface SegmentAudioTake {
  path: string;
  take: number;
  createdAt: string | null;
  verification: SegmentVerification;
}

export interface SegmentRecord {
  id: string;
  order: number;
  speakerId: string;
  text: string;
  emotion: SegmentEmotion;
  audioPath: string;
  audioTake: number;
  audioCreatedAt: string | null;
  previousTake: SegmentAudioTake | null;
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

// Only brightness + vignette are overridable — the operator complaint is
// specifically about excessive darkening on already-dark footage, not
// color, so saturation stays a single global config knob
// (config/app.json's video.grade.saturation) to keep this small.
// null = fall through to the next precedence level (see resolveGrade in
// src/lib/grade.ts, mirrored by resolve_grade in workers/common.py).
export interface GradeOverride {
  brightness: number | null;
  vignette: boolean | null;
}

export interface VideoMediaAsset extends MediaAssetBase {
  category: 'scene_video';
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudioStream: boolean;
  gradeOverride: GradeOverride;
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
  // Per-story override, layered on top of the scene video's own
  // gradeOverride, on top of config/app.json's video.grade default.
  gradeOverride: GradeOverride;
  // True once the operator hand-edits any of the three *GainDb fields via the
  // Video tab (as opposed to the plan being freshly built from library
  // defaults, or randomized). While true, approving final audio leaves gain
  // alone instead of re-syncing it from the media library's current
  // defaults — see syncVideoPlanGainToLibraryDefaults in json-store.ts.
  gainManuallyEdited: boolean;
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

// YouTube upload metadata — generated by an OpenAI structured-outputs call
// (src/lib/openai-metadata.ts) once the final video is approved, then
// reviewed/edited by the operator before approval. The description shown to
// the operator is a fixed channel template (config/templates/
// youtube-description.txt) with only teaser filled in by AI — see
// VIDEO_ASSEMBLY_PLAN.md-adjacent design notes for why the boilerplate
// (branding, disclaimers, CTA, copyright) is never AI-generated.
export interface YoutubeMetadataFile {
  schemaVersion: number;
  status: 'pending' | 'generated' | 'failed';
  generatedAt: string | null;
  model: string | null;
  // Snapshot of what the generation was based on, so a stale metadata file
  // (story text edited since) can eventually be detected/flagged.
  sourceSnapshot: {
    storyTitle: string;
    videoDurationMs: number | null;
    storyTextHash: string;
  } | null;
  titles: string[];
  selectedTitleIndex: number;
  teaser: string;
  tags: string[];
  category: string;
  thumbnailPrompts: string[];
  pinnedComment: string[];
  selectedPinnedCommentIndex: number;
  // Derived, not AI output: slugify(title) -> PascalCase (see
  // slugifyForHashtag in youtube-description.ts).
  storyHashtag: string;
  // Fixed template + teaser/storyHashtag/title filled in — what the operator
  // actually copies into YouTube Studio.
  renderedDescription: string;
  error: string | null;
}

// The independently-regenerable groups an operator can re-roll without
// clobbering the rest of the metadata file. tags+category are grouped
// together since they come from the same "topic" reasoning step.
export type YoutubeMetadataFieldGroup =
  | 'titles'
  | 'teaser'
  | 'tagsAndCategory'
  | 'thumbnailPrompts'
  | 'pinnedComment';

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
  youtubeMetadata: YoutubeMetadataFile;
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
