'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, FilePlus2, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { storiesApi } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';
import type { StoryIndexEntry } from '@/types/story';

export const DashboardClient: React.FC = () => {
  const router = useRouter();
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [title, setTitle] = useState<string>('');
  const [storyText, setStoryText] = useState<string>('');
  const [message, setMessage] = useState<string>('Loading stories...');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const loadStories = useCallback(async (): Promise<void> => {
    try {
      const nextStories = await storiesApi.list();
      setStories(nextStories);
      setMessage(nextStories.length ? '' : 'No stories yet. Create the first workspace.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load stories');
    }
  }, []);

  useEffect(() => {
    void loadStories();
  }, [loadStories]);

  const handleCreate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (!title.trim()) {
        setMessage('Title is required.');
        return;
      }

      setIsSubmitting(true);
      setMessage('Creating story workspace...');
      try {
        const story = await storiesApi.create({ title, storyText });
        router.push(`/stories/${story.id}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not create story');
      } finally {
        setIsSubmitting(false);
      }
    },
    [router, storyText, title],
  );

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">MVP Control Room</div>
            <h1>Verified horror narration</h1>
            <p>
              Write a story, process narrator and character segments, verify TTS with
              Whisper, then concatenate a final WAV.
            </p>
          </div>
          <button className="button secondary" type="button" onClick={() => void loadStories()}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>

        <section className="grid">
          <form className="panel form" onSubmit={handleCreate}>
            <h2>Create Story</h2>
            <label className="field">
              <span className="label">Title</span>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Can phong cuoi hanh lang"
              />
            </label>
            <label className="field">
              <span className="label">Initial story text</span>
              <textarea
                className="textarea"
                value={storyText}
                onChange={(event) => setStoryText(event.target.value)}
                placeholder="Paste or write the opening draft here. You can continue editing inside the workspace."
              />
            </label>
            <button className="button" type="submit" disabled={isSubmitting}>
              <FilePlus2 size={16} aria-hidden="true" />
              Create workspace
            </button>
            {message ? <p>{message}</p> : null}
          </form>

          <section className="panel">
            <div className="page-header">
              <div>
                <h2>Stories</h2>
                <p>{stories.length} local workspace{stories.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            <div className="story-list">
              {stories.map((story) => (
                <Link className="story-item" href={`/stories/${story.id}`} key={story.id}>
                  <div className="status-line">
                    <strong>{story.title}</strong>
                    <span className="badge">{story.status}</span>
                  </div>
                  <span className="mono">{story.id}</span>
                  <span className="label">Updated {new Date(story.updatedAt).toLocaleString()}</span>
                </Link>
              ))}
              {stories.length === 0 ? (
                <div className="story-item">
                  <Archive size={18} aria-hidden="true" />
                  <p>Story workspaces will appear here after creation.</p>
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </main>
    </AppShell>
  );
};

export default DashboardClient;
