import type { StoryStatus } from '@/types/story';

export type DashboardTab = 'active' | 'verified_audio' | 'verified_video' | 'archived';

export const DASHBOARD_TAB_IDS: DashboardTab[] = [
  'active',
  'verified_audio',
  'verified_video',
  'archived',
];

// The same three-and-archived bucketing the dashboard's tabs use, factored
// out so the story workspace page can figure out which bucket the story it's
// looking at belongs to (for its "Next story" button) without duplicating
// this logic.
export function dashboardTabForStory(story: { status: StoryStatus; archived: boolean }): DashboardTab {
  if (story.archived) {
    return 'archived';
  }
  if (story.status === 'video_complete' || story.status === 'metadata_ready') {
    return 'verified_video';
  }
  if (story.status === 'audio_complete') {
    return 'verified_audio';
  }
  return 'active';
}

export function storiesInDashboardTab<T extends { status: StoryStatus; archived: boolean }>(
  stories: T[],
  tab: DashboardTab,
): T[] {
  return stories.filter((story) => dashboardTabForStory(story) === tab);
}
