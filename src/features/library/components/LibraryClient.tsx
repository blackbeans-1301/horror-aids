'use client';

import Link from 'next/link';
import {
  Archive,
  ArrowUpRight,
  BookCheck,
  CloudDownload,
  FileInput,
  Info,
  Loader2,
  PenLine,
  RefreshCcw,
  Undo2,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { libraryApi } from '@/features/library/api/libraryApi';
import { storiesApi } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';
import type { ContentStoryEntry, ContentStoryStatus } from '@/types/story';

interface TabDef {
  id: ContentStoryStatus;
  label: string;
  icon: React.ReactNode;
  description: string;
  emptyLabel: string;
}

const TABS: TabDef[] = [
  {
    id: 'draft',
    label: 'Draft',
    icon: <PenLine size={14} aria-hidden="true" />,
    description: 'Truyện đang viết, chưa sẵn sàng để xử lý.',
    emptyLabel: 'Không có truyện draft.',
  },
  {
    id: 'approved',
    label: 'Approved',
    icon: <BookCheck size={14} aria-hidden="true" />,
    description: 'Sẵn sàng để nhập vào workspace và generate.',
    emptyLabel: 'Chưa có truyện nào được duyệt.',
  },
  {
    id: 'processing',
    label: 'Processing',
    icon: <Loader2 size={14} aria-hidden="true" />,
    description:
      'Đã nhập vào workspace — trạng thái này tự cập nhật theo workspace, không chỉnh tay được ở đây.',
    emptyLabel: 'Chưa có truyện nào đang xử lý.',
  },
  {
    id: 'archived',
    label: 'Archived',
    icon: <Archive size={14} aria-hidden="true" />,
    description: 'Đã generate xong. Thường được tự động chuyển khi archive ở workspace.',
    emptyLabel: 'Chưa có truyện nào được lưu trữ.',
  },
];

function LibrarySection({
  description,
  entries,
  emptyLabel,
  renderActions,
}: {
  description: string;
  entries: ContentStoryEntry[];
  emptyLabel: string;
  renderActions: (entry: ContentStoryEntry) => React.ReactNode;
}): React.ReactElement {
  return (
    <Card>
      <p>{description}</p>
      <div className="story-list">
        {entries.map((entry) => (
          <div className="story-item" key={entry.id}>
            <Link href={`/library/${entry.id}`}>
              <div className="status-line">
                <strong>{entry.title}</strong>
                <Badge>{entry.chapterCount} chương</Badge>
              </div>
              <span className="mono">{entry.id}</span>
              {entry.linkedStorySlug ? (
                <span className="label">Đã liên kết workspace: {entry.linkedStorySlug}</span>
              ) : null}
              {entry.updatedAt ? (
                <span className="label">Cập nhật {new Date(entry.updatedAt).toLocaleString()}</span>
              ) : null}
            </Link>
            <div className="button-row">{renderActions(entry)}</div>
          </div>
        ))}
        {entries.length === 0 ? (
          <div className="story-item empty">
            <BookCheck size={18} aria-hidden="true" />
            <p>{emptyLabel}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export const LibraryClient: React.FC = () => {
  const [stories, setStories] = useState<ContentStoryEntry[]>([]);
  const [message, setMessage] = useState<string>('Đang tải thư viện...');
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentStoryStatus>('draft');
  const confirm = useConfirm();

  const loadStories = useCallback(async (): Promise<void> => {
    try {
      const nextStories = await libraryApi.list();
      setStories(nextStories);
      setMessage(nextStories.length ? '' : 'Không tìm thấy truyện nào trong content/horror-stories.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải thư viện truyện');
    }
  }, []);

  useEffect(() => {
    void loadStories();
  }, [loadStories]);

  const handlePull = useCallback(async (): Promise<void> => {
    setIsPulling(true);
    try {
      await libraryApi.pull();
      toast.success('Đã pull dữ liệu mới nhất từ horror-stories.');
      await loadStories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pull thất bại');
    } finally {
      setIsPulling(false);
    }
  }, [loadStories]);

  const handleSetStatus = useCallback(
    async (entry: ContentStoryEntry, status: ContentStoryEntry['status']): Promise<void> => {
      setBusyId(entry.id);
      try {
        await libraryApi.setStatus(entry.id, status);
        toast.success(`Đã cập nhật "${entry.title}" → ${status}.`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái');
      } finally {
        setBusyId(null);
      }
    },
    [loadStories],
  );

  const handleImport = useCallback(
    async (entry: ContentStoryEntry): Promise<void> => {
      setBusyId(entry.id);
      try {
        await libraryApi.import(entry.id);
        toast.success(`Đã nhập "${entry.title}" vào workspace xử lý.`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Không thể nhập truyện');
      } finally {
        setBusyId(null);
      }
    },
    [loadStories],
  );

  // Importing is create-once (see importContentStory) — it never picks up
  // edits made to the chapter files after the first import. This is the
  // explicit, destructive re-sync for that case: overwrite the linked
  // workspace's text with the latest chapters and reset its approvals.
  const handleResync = useCallback(
    async (entry: ContentStoryEntry): Promise<void> => {
      if (!entry.linkedStorySlug) {
        return;
      }
      const confirmed = await confirm({
        title: 'Nhập lại nội dung từ Thư viện?',
        description:
          `Ghi đè nội dung truyện "${entry.title}" trong workspace bằng bản chương mới nhất và ` +
          'reset toàn bộ tiến độ duyệt (segments, audio, video) về pending. Không thể hoàn tác.',
        confirmLabel: 'Nhập lại và reset',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      setBusyId(entry.id);
      try {
        await storiesApi.syncFromLibrary(entry.linkedStorySlug);
        toast.success(`Đã nhập lại nội dung mới cho "${entry.title}".`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Không thể nhập lại');
      } finally {
        setBusyId(null);
      }
    },
    [confirm, loadStories],
  );

  // Archived is derived from the linked workspace's own archived flag (see
  // deriveStatus in src/lib/content-library.ts), so unarchiving here must
  // flip that same flag — not write a separate, disconnected library status.
  const handleUnarchiveWorkspace = useCallback(
    async (entry: ContentStoryEntry): Promise<void> => {
      if (!entry.linkedStorySlug) {
        return;
      }
      setBusyId(entry.id);
      try {
        await storiesApi.setArchived(entry.linkedStorySlug, false);
        toast.success(`Đã bỏ lưu trữ "${entry.title}".`);
        await loadStories();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Không thể bỏ lưu trữ');
      } finally {
        setBusyId(null);
      }
    },
    [loadStories],
  );

  const byStatus = (status: ContentStoryStatus): ContentStoryEntry[] =>
    stories.filter((story) => story.status === status);

  const activeTabDef = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const activeEntries = byStatus(activeTab);

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">Duyệt truyện · Nhập vào xử lý</div>
            <h1>Thư viện truyện</h1>
            <p>Theo dõi truyện từ bản thảo đến khi đã generate xong, rồi đưa sang workspace TTS.</p>
          </div>
          <div className="header-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => void handlePull()}
              disabled={isPulling}
            >
              <CloudDownload size={16} aria-hidden="true" />
              {isPulling ? 'Đang pull...' : 'Pull mới nhất'}
            </Button>
            <span className="label">
              Nguồn: <span className="mono">content/horror-stories</span>
            </span>
          </div>
        </div>

        {message ? (
          <div className="status-banner">
            <Info size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        <div className="tabs">
          {TABS.map((tab) => (
            <Button
              variant={activeTab === tab.id ? undefined : 'secondary'}
              size="sm"
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
              <Badge>{byStatus(tab.id).length}</Badge>
            </Button>
          ))}
        </div>

        {activeTab === 'draft' ? (
          <LibrarySection
            description={activeTabDef.description}
            entries={activeEntries}
            emptyLabel={activeTabDef.emptyLabel}
            renderActions={(entry) => (
              <Button
                size="sm"
                type="button"
                disabled={busyId === entry.id}
                onClick={() => void handleSetStatus(entry, 'approved')}
              >
                <BookCheck size={15} aria-hidden="true" />
                Duyệt
              </Button>
            )}
          />
        ) : null}

        {activeTab === 'approved' ? (
          <LibrarySection
            description={activeTabDef.description}
            entries={activeEntries}
            emptyLabel={activeTabDef.emptyLabel}
            renderActions={(entry) => (
              <>
                <Button
                  size="sm"
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void handleImport(entry)}
                >
                  <FileInput size={15} aria-hidden="true" />
                  Nhập vào xử lý
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void handleSetStatus(entry, 'draft')}
                >
                  <Undo2 size={15} aria-hidden="true" />
                  Trả về Draft
                </Button>
              </>
            )}
          />
        ) : null}

        {activeTab === 'processing' ? (
          <LibrarySection
            description={activeTabDef.description}
            entries={activeEntries}
            emptyLabel={activeTabDef.emptyLabel}
            renderActions={(entry) =>
              entry.linkedStorySlug ? (
                <>
                  <Button asChild size="sm">
                    <Link href={`/stories/${entry.linkedStorySlug}`}>
                      <ArrowUpRight size={15} aria-hidden="true" />
                      Mở workspace
                    </Link>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={busyId === entry.id}
                    title="Nội dung chương đã sửa sau khi nhập? Đồng bộ lại vào workspace."
                    onClick={() => void handleResync(entry)}
                  >
                    <RefreshCcw size={15} aria-hidden="true" />
                    Nhập lại
                  </Button>
                </>
              ) : null
            }
          />
        ) : null}

        {activeTab === 'archived' ? (
          <LibrarySection
            description={activeTabDef.description}
            entries={activeEntries}
            emptyLabel={activeTabDef.emptyLabel}
            renderActions={(entry) => (
              <>
                {entry.linkedStorySlug ? (
                  <Button asChild size="sm">
                    <Link href={`/stories/${entry.linkedStorySlug}`}>
                      <ArrowUpRight size={15} aria-hidden="true" />
                      Mở workspace
                    </Link>
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={busyId === entry.id || !entry.linkedStorySlug}
                  onClick={() => void handleUnarchiveWorkspace(entry)}
                >
                  <Archive size={15} aria-hidden="true" />
                  Bỏ lưu trữ
                </Button>
              </>
            )}
          />
        ) : null}
      </main>
    </AppShell>
  );
};

export default LibraryClient;
