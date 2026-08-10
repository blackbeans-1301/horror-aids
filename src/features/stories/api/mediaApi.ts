import type { MediaAsset, MediaCategory } from '@/types/story';

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; referencedBy?: string[] };
    const error = new Error(body.error ?? `Request failed: ${response.status}`) as Error & {
      referencedBy?: string[];
    };
    error.referencedBy = body.referencedBy;
    throw error;
  }
  return (await response.json()) as T;
}

export const mediaApi = {
  async list(category?: MediaCategory): Promise<MediaAsset[]> {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    const data = await requestJson<{ media: MediaAsset[] }>(`/api/media${query}`);
    return data.media;
  },

  // Exactly one of file/sourcePath: `file` goes through the usual browser
  // upload; `sourcePath` (an absolute path on the machine the server itself
  // runs on) skips it entirely — the server copies the file directly on
  // disk instead of reading it through HTTP.
  async upload(input: {
    file?: File;
    sourcePath?: string;
    category: MediaCategory;
    name: string;
    source?: string;
    notes?: string;
    loopable?: boolean;
  }): Promise<MediaAsset> {
    const form = new FormData();
    if (input.sourcePath) {
      form.set('sourcePath', input.sourcePath);
    } else if (input.file) {
      form.set('file', input.file);
    }
    form.set('category', input.category);
    form.set('name', input.name);
    form.set('source', input.source ?? '');
    form.set('notes', input.notes ?? '');
    form.set('loopable', String(input.loopable ?? true));
    const data = await requestJson<{ media: MediaAsset }>('/api/media', { method: 'POST', body: form });
    return data.media;
  },

  async update(
    id: string,
    patch: {
      name?: string;
      category?: MediaCategory;
      source?: string;
      notes?: string;
      loopable?: boolean;
      defaultGainDb?: number;
    },
  ): Promise<MediaAsset> {
    const data = await requestJson<{ media: MediaAsset }>(`/api/media?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return data.media;
  },

  async remove(id: string, force = false): Promise<void> {
    await requestJson(`/api/media?id=${encodeURIComponent(id)}${force ? '&force=1' : ''}`, {
      method: 'DELETE',
    });
  },

  assetUrl(id: string): string {
    return `/api/media/asset?id=${encodeURIComponent(id)}`;
  },
};
