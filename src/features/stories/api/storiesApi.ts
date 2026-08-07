import type {
  CharactersFile,
  JobRecord,
  JobType,
  SegmentsFile,
  StoryDetail,
  StoryIndexEntry,
  StoryRecord,
} from '@/types/story';

async function requestJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export interface VoiceOption {
  id: string;
  description: string;
  kind: 'preset' | 'clone';
}

export const storiesApi = {
  async voices(): Promise<{ voices: VoiceOption[]; error?: string }> {
    return requestJson<{ voices: VoiceOption[]; error?: string }>('/api/voices');
  },

  async list(): Promise<StoryIndexEntry[]> {
    const data = await requestJson<{ stories: StoryIndexEntry[] }>('/api/stories');
    return data.stories;
  },

  async create(payload: {
    title: string;
    storyText: string;
  }): Promise<StoryRecord> {
    const data = await requestJson<{ story: StoryRecord }>('/api/stories', {
      method: 'POST',
      body: JSON.stringify({ ...payload, sourceType: 'manual' }),
    });
    return data.story;
  },

  async detail(slug: string): Promise<StoryDetail> {
    return requestJson<StoryDetail>(`/api/stories/${slug}`);
  },

  async setArchived(slug: string, archived: boolean): Promise<StoryRecord> {
    const data = await requestJson<{ story: StoryRecord }>(`/api/stories/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    });
    return data.story;
  },

  async saveStoryText(slug: string, storyText: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/story-text`, {
      method: 'PUT',
      body: JSON.stringify({ storyText }),
    });
  },

  async saveCharacters(
    slug: string,
    characters: CharactersFile,
  ): Promise<CharactersFile & { droppedCount: number }> {
    return requestJson<CharactersFile & { droppedCount: number }>(
      `/api/stories/${slug}/characters`,
      {
        method: 'PUT',
        body: JSON.stringify(characters),
      },
    );
  },

  async saveSegments(
    slug: string,
    segments: SegmentsFile,
  ): Promise<SegmentsFile & { droppedCount: number }> {
    return requestJson<SegmentsFile & { droppedCount: number }>(`/api/stories/${slug}/segments`, {
      method: 'PUT',
      body: JSON.stringify(segments),
    });
  },

  async approveSegments(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/approve-segments`, { method: 'POST' });
  },

  async confirmVerifiedAudio(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/confirm-verified-audio`, { method: 'POST' });
  },

  async approveFinalAudio(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/approve-final-audio`, { method: 'POST' });
  },

  async startJob(slug: string, type: JobType, segmentIds?: string[]): Promise<JobRecord> {
    const data = await requestJson<{ job: JobRecord }>(`/api/stories/${slug}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ type, segmentIds }),
    });
    return data.job;
  },

  async stopJob(slug: string): Promise<JobRecord> {
    const data = await requestJson<{ job: JobRecord }>(`/api/stories/${slug}/jobs/stop`, {
      method: 'POST',
    });
    return data.job;
  },

  async jobLog(jobId: string): Promise<string> {
    const data = await requestJson<{ log: string }>(`/api/jobs/${jobId}/log`);
    return data.log;
  },
};
