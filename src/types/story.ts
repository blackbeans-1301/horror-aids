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
  | 'reddit_import_later';

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

export type JobType = 'process_story' | 'generate_verify_tts' | 'concat_audio';

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
  };
  audio: {
    segmentsDir: string;
    finalPath: string;
    status: 'pending' | 'running' | 'verified' | 'complete' | 'failed';
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

export interface StoryDetail {
  story: StoryRecord;
  storyText: string;
  characters: CharactersFile;
  segments: SegmentsFile;
  activeJob: JobRecord | null;
  recentJobs: JobRecord[];
  finalAudioExists: boolean;
}
