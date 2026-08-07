'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, FilePlus2, FileUp, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { storiesApi } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';
import { readStoryFilesAsText } from '@/features/stories/utils/readStoryFiles';
import type { StoryIndexEntry } from '@/types/story';

export const DashboardClient: React.FC = () => {
  const router = useRouter();
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [title, setTitle] = useState<string>('');
  const [storyText, setStoryText] = useState<string>('');
  const [message, setMessage] = useState<string>('Loading stories...');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleToggleArchive = useCallback(
    async (story: StoryIndexEntry): Promise<void> => {
      try {
        await storiesApi.setArchived(story.id, !story.archived);
        toast.success(story.archived ? `Unarchived "${story.title}".` : `Archived "${story.title}".`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not update story');
      }
    },
    [loadStories],
  );

  const handleCreate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (!title.trim()) {
        toast.error('Title is required.');
        return;
      }

      setIsSubmitting(true);
      try {
        const story = await storiesApi.create({ title, storyText });
        toast.success(`Created "${story.title}".`);
        router.push(`/stories/${story.id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not create story');
      } finally {
        setIsSubmitting(false);
      }
    },
    [router, storyText, title],
  );

  const handleUploadFiles = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const text = await readStoryFilesAsText(files);
    setStoryText(text);
    event.target.value = '';
  }, []);

  const visibleStories = stories.filter((story) => story.archived === showArchived);

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

        <div className="waveform-divider" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
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
            <div className="button-row">
              <button className="button" type="submit" disabled={isSubmitting}>
                <FilePlus2 size={16} aria-hidden="true" />
                Create workspace
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                <FileUp size={16} aria-hidden="true" />
                Upload markdown
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,text/markdown"
                multiple
                hidden
                onChange={(event) => void handleUploadFiles(event)}
              />
            </div>
            {message ? <p>{message}</p> : null}
          </form>

          <section className="panel">
            <div className="page-header">
              <div>
                <h2>Stories</h2>
                <p>
                  {visibleStories.length} {showArchived ? 'archived' : 'active'} local workspace
                  {visibleStories.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="button-row">
                <button
                  className={showArchived ? 'button secondary' : 'button'}
                  type="button"
                  onClick={() => setShowArchived(false)}
                >
                  Active
                </button>
                <button
                  className={showArchived ? 'button' : 'button secondary'}
                  type="button"
                  onClick={() => setShowArchived(true)}
                >
                  Archived
                </button>
              </div>
            </div>
            <div className="story-list">
              {visibleStories.map((story) => (
                <div className={`story-item${story.archived ? ' archived' : ''}`} key={story.id}>
                  <Link href={`/stories/${story.id}`}>
                    <div className="status-line">
                      <strong>{story.title}</strong>
                      <span className="badge">{story.status}</span>
                    </div>
                    <span className="mono">{story.id}</span>
                    <span className="label">Updated {new Date(story.updatedAt).toLocaleString()}</span>
                  </Link>
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => void handleToggleArchive(story)}
                  >
                    <Archive size={15} aria-hidden="true" />
                    {story.archived ? 'Unarchive' : 'Archive'}
                  </button>
                </div>
              ))}
              {visibleStories.length === 0 ? (
                <div className="story-item empty">
                  <Archive size={18} aria-hidden="true" />
                  <p>
                    {showArchived
                      ? 'No archived stories.'
                      : 'Story workspaces will appear here after creation.'}
                  </p>
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
