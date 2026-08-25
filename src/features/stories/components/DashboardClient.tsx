'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, AudioLines, BookOpen, Clapperboard, FilePlus2, FileUp, ListChecks, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { storiesApi } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';
import { readStoryFilesAsText } from '@/features/stories/utils/readStoryFiles';
import type { StoryIndexEntry } from '@/types/story';

type DashboardTab = 'active' | 'verified_audio' | 'verified_video' | 'archived';

const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string; icon: React.ReactNode }> = [
  { id: 'active', label: 'Active', icon: <ListChecks size={14} aria-hidden="true" /> },
  { id: 'verified_audio', label: 'Verified Audio', icon: <AudioLines size={14} aria-hidden="true" /> },
  { id: 'verified_video', label: 'Verified Video', icon: <Clapperboard size={14} aria-hidden="true" /> },
  { id: 'archived', label: 'Archived', icon: <Archive size={14} aria-hidden="true" /> },
];

const ACTIVE_TAB_KEY = 'horror-aids:dashboard-active-tab';

function isDashboardTab(value: string | null): value is DashboardTab {
  return value !== null && DASHBOARD_TABS.some((tab) => tab.id === value);
}

export const DashboardClient: React.FC = () => {
  const router = useRouter();
  const [stories, setStories] = useState<StoryIndexEntry[]>([]);
  const [title, setTitle] = useState<string>('');
  const [storyText, setStoryText] = useState<string>('');
  const [message, setMessage] = useState<string>('Loading stories...');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('active');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();

  // Read the last-viewed tab after mount only, so the very first client
  // render matches the server-rendered HTML (both default to 'active') and
  // localStorage never causes a hydration mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ACTIVE_TAB_KEY);
      if (isDashboardTab(stored)) {
        setActiveTab(stored);
      }
    } catch {
      // ignore malformed/inaccessible storage
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    } catch {
      // best-effort persistence only
    }
  }, [activeTab]);

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

  // Archive is normally the only removal mechanism in this app — this is a
  // narrow, explicit exception for throwaway test workspaces cluttering the
  // Archived tab. Only reachable from there, and the server independently
  // refuses to delete anything that isn't already archived.
  const handleDeletePermanently = useCallback(
    async (story: StoryIndexEntry): Promise<void> => {
      const confirmed = await confirm({
        title: 'Xoá vĩnh viễn workspace này?',
        description:
          `Xoá toàn bộ folder "${story.id}" (story.json, audio, video, logs...) khỏi đĩa. ` +
          `Không thể hoàn tác, không có bản sao. Chỉ dùng cho workspace test/rác — nếu đây là ` +
          'truyện thật, dùng Unarchive thay vì xoá.',
        confirmLabel: 'Xoá vĩnh viễn',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        await storiesApi.deletePermanently(story.id);
        toast.success(`Đã xoá vĩnh viễn "${story.title}".`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not delete story');
      }
    },
    [confirm, loadStories],
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

  // Three mutually exclusive buckets for a non-archived story, by how far its
  // pipeline has gone: still in progress, audio done but video not yet
  // approved, or fully done (video approved — metadata approval afterward
  // keeps it here, it doesn't regress the story back to "in progress").
  const byTab = (tab: DashboardTab): StoryIndexEntry[] =>
    stories.filter((story) => {
      if (tab === 'archived') {
        return story.archived;
      }
      if (story.archived) {
        return false;
      }
      if (tab === 'verified_video') {
        return story.status === 'video_complete' || story.status === 'metadata_ready';
      }
      if (tab === 'verified_audio') {
        return story.status === 'audio_complete';
      }
      return (
        story.status !== 'video_complete' &&
        story.status !== 'metadata_ready' &&
        story.status !== 'audio_complete'
      );
    });

  const visibleStories = byTab(activeTab);
  const emptyLabel =
    activeTab === 'archived'
      ? 'No archived stories.'
      : activeTab === 'verified_video'
        ? 'No completed videos yet — approve a final video in a workspace to see it here.'
        : activeTab === 'verified_audio'
          ? 'No stories with verified audio yet — approve final audio in a workspace to see it here.'
          : 'Story workspaces will appear here after creation.';

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
          <div className="button-row">
            <Button asChild variant="secondary">
              <Link href="/library">
                <BookOpen size={16} aria-hidden="true" />
                Sync từ Thư viện
              </Link>
            </Button>
          </div>
        </div>

        <div className="waveform-divider" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>

        <section className="layout-grid">
          <Card>
            <form className="grid gap-3" onSubmit={handleCreate}>
              <CardTitle>Create Story</CardTitle>
              <div className="grid gap-1.5">
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Can phong cuoi hanh lang"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Initial story text</Label>
                <Textarea
                  value={storyText}
                  onChange={(event) => setStoryText(event.target.value)}
                  placeholder="Paste or write the opening draft here. You can continue editing inside the workspace."
                />
              </div>
              <div className="button-row">
                <Button type="submit" disabled={isSubmitting}>
                  <FilePlus2 size={16} aria-hidden="true" />
                  Create workspace
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <FileUp size={16} aria-hidden="true" />
                  Upload markdown
                </Button>
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
          </Card>

          <Card>
            <div className="page-header">
              <div>
                <CardTitle>Stories</CardTitle>
                <p>
                  {visibleStories.length} {activeTab} local workspace
                  {visibleStories.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="tabs">
                {DASHBOARD_TABS.map((tab) => (
                  <Button
                    variant={activeTab === tab.id ? undefined : 'secondary'}
                    size="sm"
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.icon}
                    {tab.label}
                    <Badge>{byTab(tab.id).length}</Badge>
                  </Button>
                ))}
              </div>
            </div>
            <div className="story-list">
              {visibleStories.map((story) => (
                <div className={`story-item${story.archived ? ' archived' : ''}`} key={story.id}>
                  <Link href={`/stories/${story.id}`}>
                    <div className="status-line">
                      <strong>{story.title}</strong>
                      <Badge>{story.status}</Badge>
                    </div>
                    <span className="mono">{story.id}</span>
                    <span className="label">Updated {new Date(story.updatedAt).toLocaleString()}</span>
                  </Link>
                  <div className="button-row">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => void handleToggleArchive(story)}
                    >
                      <Archive size={15} aria-hidden="true" />
                      {story.archived ? 'Unarchive' : 'Archive'}
                    </Button>
                    {story.archived ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        title="Xoá vĩnh viễn — chỉ dùng cho workspace test/rác"
                        onClick={() => void handleDeletePermanently(story)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        Xoá vĩnh viễn
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {visibleStories.length === 0 ? (
                <div className="story-item empty">
                  <Archive size={18} aria-hidden="true" />
                  <p>{emptyLabel}</p>
                </div>
              ) : null}
            </div>
          </Card>
        </section>
      </main>
    </AppShell>
  );
};

export default DashboardClient;
