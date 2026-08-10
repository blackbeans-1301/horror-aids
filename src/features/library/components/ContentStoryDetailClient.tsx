'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileInput } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'react-toastify';

import { libraryApi } from '@/features/library/api/libraryApi';
import { AppShell } from '@/features/stories/components/AppShell';
import type { ContentStoryDetail, ContentStoryDocuments } from '@/types/story';

type DocTab = keyof ContentStoryDocuments;
type TabId = DocTab | 'chapters';

const DOC_TABS: { id: DocTab; label: string; emptyLabel: string }[] = [
  { id: 'bible', label: 'Bible', emptyLabel: 'Truyện này chưa có Bible.md.' },
  { id: 'characters', label: 'Characters', emptyLabel: 'Truyện này chưa có Characters.md.' },
  { id: 'outline', label: 'Outline & Timeline', emptyLabel: 'Truyện này chưa có Outline_Timeline.md.' },
  { id: 'factDb', label: 'Fact DB', emptyLabel: 'Truyện này chưa có Fact_DB.md.' },
  { id: 'progress', label: 'Progress', emptyLabel: 'Truyện này chưa có Progress.md.' },
];

export const ContentStoryDetailClient: React.FC<{ id: string }> = ({ id }) => {
  const router = useRouter();
  const [detail, setDetail] = useState<ContentStoryDetail | null>(null);
  const [message, setMessage] = useState<string>('Đang tải truyện...');
  const [activeTab, setActiveTab] = useState<TabId>('bible');
  const [chapterIndex, setChapterIndex] = useState<number>(0);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextDetail = await libraryApi.detail(id);
        if (!cancelled) {
          setDetail(nextDetail);
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Không thể tải truyện');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setIsImporting(true);
    try {
      const { slug } = await libraryApi.import(detail.id);
      toast.success(`Đã nhập "${detail.title}" vào workspace xử lý.`);
      router.push(`/stories/${slug}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể nhập truyện');
    } finally {
      setIsImporting(false);
    }
  }, [detail, router]);

  return (
    <AppShell>
      <main className="page">
        <Link className="button secondary small" href="/library">
          <ArrowLeft size={14} aria-hidden="true" />
          Thư viện truyện
        </Link>

        {message ? (
          <div className="status-banner">
            <span>{message}</span>
          </div>
        ) : null}

        {detail ? (
          <>
            <div className="page-header">
              <div>
                <div className="eyebrow">{detail.status}</div>
                <h1>{detail.title}</h1>
                <div className="status-line">
                  <span className="mono">{detail.id}</span>
                  <span className="badge">{detail.chapterCount} chương</span>
                  {detail.linkedStorySlug ? (
                    <span className="label">
                      Workspace: <Link href={`/stories/${detail.linkedStorySlug}`}>{detail.linkedStorySlug}</Link>
                    </span>
                  ) : null}
                </div>
              </div>
              {detail.status === 'approved' ? (
                <button className="button" type="button" onClick={() => void handleImport()} disabled={isImporting}>
                  <FileInput size={16} aria-hidden="true" />
                  {isImporting ? 'Đang nhập...' : 'Nhập vào xử lý'}
                </button>
              ) : null}
            </div>

            <div className="tabs">
              {DOC_TABS.map((tab) => (
                <button
                  className={activeTab === tab.id ? 'tab active' : 'tab'}
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
              <button
                className={activeTab === 'chapters' ? 'tab active' : 'tab'}
                type="button"
                onClick={() => setActiveTab('chapters')}
              >
                Chapters <span className="badge">{detail.chapters.length}</span>
              </button>
            </div>

            {DOC_TABS.filter((tab) => tab.id === activeTab).map((tab) => (
              <section className="panel" key={tab.id}>
                {detail.documents[tab.id] ? (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.documents[tab.id]}</ReactMarkdown>
                  </div>
                ) : (
                  <p>{tab.emptyLabel}</p>
                )}
              </section>
            ))}

            {activeTab === 'chapters' ? (
              <section className="panel">
                {detail.chapters.length === 0 ? (
                  <p>Truyện này chưa có chương nào.</p>
                ) : (
                  <div className="chapter-layout">
                    <div className="chapter-list">
                      {detail.chapters.map((chapter, index) => (
                        <button
                          className={index === chapterIndex ? 'chapter-list-item active' : 'chapter-list-item'}
                          key={chapter.file}
                          type="button"
                          onClick={() => setChapterIndex(index)}
                        >
                          {chapter.title}
                        </button>
                      ))}
                    </div>
                    <div className="log">{detail.chapters[chapterIndex]?.content}</div>
                  </div>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
};

export default ContentStoryDetailClient;
