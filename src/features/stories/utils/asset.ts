import type { SegmentRecord } from '@/types/story';

export function assetUrl(slug: string, relativePath: string): string {
  return `/api/stories/${slug}/asset?path=${encodeURIComponent(relativePath)}`;
}

export function segmentAudioPath(segment: SegmentRecord): string {
  return segment.audioPath;
}
