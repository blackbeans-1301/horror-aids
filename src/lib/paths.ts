import path from 'node:path';

export const projectRoot = process.cwd();
export const dataRoot = path.join(projectRoot, 'data');
export const storiesRoot = path.join(projectRoot, 'stories');
export const workersRoot = path.join(projectRoot, 'workers');
export const configRoot = path.join(projectRoot, 'config');

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
