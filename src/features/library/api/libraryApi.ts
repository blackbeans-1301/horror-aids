import type { ContentStoryDetail, ContentStoryEntry, ContentStoryStatus } from '@/types/story';

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

export const libraryApi = {
  async list(): Promise<ContentStoryEntry[]> {
    const data = await requestJson<{ stories: ContentStoryEntry[] }>('/api/library');
    return data.stories;
  },

  async detail(id: string): Promise<ContentStoryDetail> {
    return requestJson<ContentStoryDetail>(`/api/library/${id}`);
  },

  async pull(): Promise<{ output: string }> {
    return requestJson<{ output: string }>('/api/library/pull', { method: 'POST' });
  },

  async setStatus(id: string, status: ContentStoryStatus): Promise<void> {
    await requestJson(`/api/library/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  async import(id: string): Promise<{ slug: string }> {
    return requestJson<{ slug: string }>(`/api/library/${id}/import`, { method: 'POST' });
  },
};
