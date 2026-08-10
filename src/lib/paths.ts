import fs from 'node:fs';
import path from 'node:path';

export const projectRoot = process.cwd();
export const dataRoot = path.join(projectRoot, 'data');
export const storiesRoot = path.join(projectRoot, 'stories');
export const workersRoot = path.join(projectRoot, 'workers');
export const configRoot = path.join(projectRoot, 'config');
export const voicePreviewCacheRoot = path.join(dataRoot, 'voice-preview-cache');

// The horror-stories writing repo, checked out as a git submodule. horror-aids
// only ever reads from it (plus `git pull` to refresh) — it's a pure data
// source, not something this app commits to. Lifecycle status lives in this
// app's own local data/ instead, same as data/index.json.
export const contentLibraryRoot = path.join(projectRoot, 'content', 'horror-stories');
export const contentLibraryStoriesDir = path.join(contentLibraryRoot, 'stories');
export const contentLibraryStatusPath = path.join(dataRoot, 'content-library-status.json');

// The omnivoice package (and its heavy ML deps) only lives in the workers'
// virtualenv, not on the system PATH — worker scripts must run under it.
export function pythonExecutable(): string {
  const venvPython = path.join(workersRoot, '.venv', 'bin', 'python3');
  return fs.existsSync(venvPython) ? venvPython : 'python3';
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || `story-${Date.now()}`;
}

export function assertValidSlug(slug: string): string {
  if (!slugPattern.test(slug)) {
    throw new Error('Invalid story slug');
  }

  return slug;
}

export function storyDir(slug: string): string {
  return path.join(storiesRoot, assertValidSlug(slug));
}

export function resolveStoryPath(slug: string, relativePath: string): string {
  const root = storyDir(slug);
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error('Path escapes story workspace');
  }

  return resolved;
}

export function toPosixPath(input: string): string {
  return input.split(path.sep).join('/');
}

const contentIdPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function assertValidContentId(id: string): string {
  if (!contentIdPattern.test(id)) {
    throw new Error('Invalid content story id');
  }

  return id;
}

export function contentStoryDir(id: string): string {
  return path.join(contentLibraryStoriesDir, assertValidContentId(id));
}

export function resolveContentPath(id: string, relativePath: string): string {
  const root = contentStoryDir(id);
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error('Path escapes content story folder');
  }

  return resolved;
}
