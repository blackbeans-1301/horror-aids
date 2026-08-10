import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { createStory, listStories, readJsonFile, writeJsonFile } from '@/lib/json-store';
import {
  assertValidContentId,
  contentLibraryStatusPath,
  contentLibraryStoriesDir,
  resolveContentPath,
} from '@/lib/paths';
import type {
  ContentChapter,
  ContentStoryDetail,
  ContentStoryDocuments,
  ContentStoryEditorialStatus,
  ContentStoryEntry,
  ContentStoryStatus,
  StoryIndexEntry,
} from '@/types/story';

interface LibraryStatusFile {
  stories: Record<string, { status: ContentStoryEditorialStatus; updatedAt: string }>;
}

async function readLibraryStatus(): Promise<LibraryStatusFile> {
  return readJsonFile<LibraryStatusFile>(contentLibraryStatusPath, { stories: {} });
}

// Some entries on disk still have 'processing'/'archived' stored from before
// those became derived-only — normalize anything that isn't literally 'draft'
// to 'approved' (the safe fallback: it was already past the draft stage).
function toEditorialStatus(raw: string | undefined): ContentStoryEditorialStatus {
  return raw === 'draft' ? 'draft' : 'approved';
}

// Once a library entry is linked to a workspace, its displayed status must
// reflect that workspace's real state, not a separately-stored copy of it —
// otherwise the two drift apart (e.g. "Trả về Approved" changing the library
// copy while the workspace stays exactly as it was).
function deriveStatus(
  editorial: ContentStoryEditorialStatus,
  linkedStory: StoryIndexEntry | undefined,
): ContentStoryStatus {
  if (!linkedStory) {
    return editorial;
  }
  return linkedStory.archived ? 'archived' : 'processing';
}

function prettifyContentId(id: string): string {
  return id
    .replace(/^\d+_/, '')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function extractTitle(id: string): Promise<string> {
  try {
    const text = await fs.readFile(resolveContentPath(id, 'Bible.md'), 'utf8');
    const match = text.match(/^Title:\s*(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return prettifyContentId(id);
}

async function listChapterFiles(id: string): Promise<string[]> {
  try {
    const files = await fs.readdir(resolveContentPath(id, 'chapters'));
    return files.filter((name) => name.toLowerCase().endsWith('.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Chapter filenames aren't consistent across stories in the writing repo —
// some are plain "1.md", others "C01_Title.md" — so sort by the first
// number found in the filename rather than trusting lexical order.
function chapterSortKey(filename: string): number {
  const match = filename.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

async function sortedChapterFiles(id: string): Promise<string[]> {
  const files = await listChapterFiles(id);
  return [...files].sort((a, b) => {
    const keyDiff = chapterSortKey(a) - chapterSortKey(b);
    return keyDiff !== 0 ? keyDiff : a.localeCompare(b);
  });
}

export async function mergeChapters(id: string): Promise<string> {
  const sorted = await sortedChapterFiles(id);
  const chaptersDir = resolveContentPath(id, 'chapters');
  const contents = await Promise.all(
    sorted.map((name) => fs.readFile(path.join(chaptersDir, name), 'utf8')),
  );
  return contents
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

// Well-formed chapters start with a "# Chương N: Title" heading (with proper
// Vietnamese diacritics); older/rougher ones (plain "1.md") don't, so fall
// back to a title derived from the filename in that case.
function chapterTitle(content: string, filename: string, index: number): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) {
    return heading[1].trim();
  }
  const base = filename.replace(/\.md$/i, '').replace(/^c?\d+_?/i, '');
  const words = base
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return words ? `Chương ${index + 1}: ${words}` : `Chương ${index + 1}`;
}

async function readChapters(id: string): Promise<ContentChapter[]> {
  const sorted = await sortedChapterFiles(id);
  const chaptersDir = resolveContentPath(id, 'chapters');
  const contents = await Promise.all(
    sorted.map((name) => fs.readFile(path.join(chaptersDir, name), 'utf8')),
  );
  return sorted.map((name, index) => ({
    file: name,
    title: chapterTitle(contents[index], name, index),
    content: contents[index],
  }));
}

async function readDoc(id: string, filename: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveContentPath(id, filename), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readDocuments(id: string): Promise<ContentStoryDocuments> {
  const [bible, characters, outline, factDb, progress] = await Promise.all([
    readDoc(id, 'Bible.md'),
    readDoc(id, 'Characters.md'),
    readDoc(id, 'Outline_Timeline.md'),
    readDoc(id, 'Fact_DB.md'),
    readDoc(id, 'Progress.md'),
  ]);
  return { bible, characters, outline, factDb, progress };
}

export async function getContentStoryDetail(id: string): Promise<ContentStoryDetail> {
  assertValidContentId(id);
  const [title, documents, chapters, statusFile, localStories] = await Promise.all([
    extractTitle(id),
    readDocuments(id),
    readChapters(id),
    readLibraryStatus(),
    listStories(),
  ]);
  const statusEntry = statusFile.stories[id];
  const linkedStory = localStories.find((story) => story.sourceContentId === id);

  return {
    id,
    title,
    status: deriveStatus(toEditorialStatus(statusEntry?.status), linkedStory),
    chapterCount: chapters.length,
    updatedAt: statusEntry?.updatedAt ?? null,
    linkedStorySlug: linkedStory?.id ?? null,
    documents,
    chapters,
  };
}

export async function listContentStories(): Promise<ContentStoryEntry[]> {
  let entries: string[];
  try {
    const dirEntries = await fs.readdir(contentLibraryStoriesDir, { withFileTypes: true });
    entries = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const [statusFile, localStories] = await Promise.all([readLibraryStatus(), listStories()]);
  const linkedBySourceId = new Map<string, StoryIndexEntry>();
  for (const story of localStories) {
    if (story.sourceContentId) {
      linkedBySourceId.set(story.sourceContentId, story);
    }
  }

  const result = await Promise.all(
    entries.map(async (id): Promise<ContentStoryEntry> => {
      const [title, chapterFiles] = await Promise.all([extractTitle(id), listChapterFiles(id)]);
      const statusEntry = statusFile.stories[id];
      const linkedStory = linkedBySourceId.get(id);
      return {
        id,
        title,
        status: deriveStatus(toEditorialStatus(statusEntry?.status), linkedStory),
        chapterCount: chapterFiles.length,
        updatedAt: statusEntry?.updatedAt ?? null,
        linkedStorySlug: linkedStory?.id ?? null,
      };
    }),
  );

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

// Purely local — the submodule is a read-only data source from this app's
// point of view (the only git operation run against it is a pull), so
// lifecycle status lives in this app's own data/ instead.
export async function setContentStoryStatus(id: string, status: ContentStoryEditorialStatus): Promise<void> {
  assertValidContentId(id);
  const current = await readLibraryStatus();
  const next: LibraryStatusFile = {
    stories: {
      ...current.stories,
      [id]: { status, updatedAt: new Date().toISOString() },
    },
  };
  await writeJsonFile(contentLibraryStatusPath, next);
}

// Create-only: if a workspace is already linked, hand back its slug without
// touching it. Re-syncing an existing workspace's text is a separate,
// explicit, destructive action (see the sync-from-library route) — this
// function must never silently reset an in-progress workspace's approvals
// just because the same library entry was imported twice.
export async function importContentStory(id: string): Promise<{ slug: string }> {
  assertValidContentId(id);
  const localStories = await listStories();
  const existing = localStories.find((story) => story.sourceContentId === id);
  if (existing) {
    return { slug: existing.id };
  }

  const [mergedText, title] = await Promise.all([mergeChapters(id), extractTitle(id)]);
  const story = await createStory({
    title,
    storyText: mergedText,
    sourceType: 'library_import',
    sourceContentId: id,
  });
  return { slug: story.id };
}
