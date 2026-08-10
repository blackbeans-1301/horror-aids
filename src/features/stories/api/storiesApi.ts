import type {
  CharactersFile,
  JobRecord,
  JobType,
  SegmentsFile,
  StoryDetail,
  StoryIndexEntry,
  StoryRecord,
  VideoPlanFile,
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

  async setSegmentFlag(
    slug: string,
    segmentId: string,
    flagged: boolean,
  ): Promise<SegmentsFile> {
    return requestJson<SegmentsFile>(`/api/stories/${slug}/segments/flag`, {
      method: 'PATCH',
      body: JSON.stringify({ segmentId, flagged }),
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

  async revealFinalAudio(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/reveal-final-audio`, { method: 'POST' });
  },

  async videoPlan(slug: string): Promise<VideoPlanFile> {
    const data = await requestJson<{ videoPlan: VideoPlanFile }>(`/api/stories/${slug}/video-plan`);
    return data.videoPlan;
  },

  async saveVideoPlan(slug: string, patch: Partial<VideoPlanFile>): Promise<VideoPlanFile> {
    const data = await requestJson<{ videoPlan: VideoPlanFile }>(`/api/stories/${slug}/video-plan`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    return data.videoPlan;
  },

  async randomizeVideoPlan(slug: string): Promise<VideoPlanFile> {
    const data = await requestJson<{ videoPlan: VideoPlanFile }>(
      `/api/stories/${slug}/video-plan/randomize`,
      { method: 'POST' },
    );
    return data.videoPlan;
  },

  async uploadIntroImage(slug: string, file: File): Promise<VideoPlanFile> {
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`/api/stories/${slug}/intro-image`, { method: 'POST', body: form });
    const data = (await response.json()) as { videoPlan?: VideoPlanFile; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? 'Upload failed');
    }
    return data.videoPlan as VideoPlanFile;
  },

  async deleteIntroImage(slug: string): Promise<VideoPlanFile> {
    const data = await requestJson<{ videoPlan: VideoPlanFile }>(`/api/stories/${slug}/intro-image`, {
      method: 'DELETE',
    });
    return data.videoPlan;
  },

  async approveFinalVideo(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/approve-final-video`, { method: 'POST' });
  },

  async revealFinalVideo(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/reveal-final-video`, { method: 'POST' });
  },

  async selectVideoRender(slug: string, jobId: string): Promise<StoryRecord> {
    const data = await requestJson<{ story: StoryRecord }>(
      `/api/stories/${slug}/video-renders/${jobId}/select`,
      { method: 'POST' },
    );
    return data.story;
  },

  async deleteVideoRender(slug: string, jobId: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/video-renders/${jobId}`, { method: 'DELETE' });
  },

  async syncFromLibrary(slug: string): Promise<void> {
    await requestJson(`/api/stories/${slug}/sync-from-library`, { method: 'POST' });
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
