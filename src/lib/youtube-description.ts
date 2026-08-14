import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { configRoot } from '@/lib/paths';

const TEMPLATE_PATH = path.join(configRoot, 'templates', 'youtube-description.txt');

// The boilerplate (branding, disclaimers, CTA, copyright) is fixed for every
// video — read once per process lifetime rather than on every generate/save.
let cachedTemplate: string | null = null;

async function loadTemplate(): Promise<string> {
  if (cachedTemplate === null) {
    cachedTemplate = await fs.readFile(TEMPLATE_PATH, 'utf8');
  }
  return cachedTemplate;
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

// Vietnamese "d with stroke" (lowercase U+0111, uppercase U+0110) doesn't
// decompose into base+diacritic under NFKD the way accented vowels do, so it
// survives a plain diacritics-strip untouched — swap it to plain "d"/"D"
// first, or it would leak into the hashtag as-is (matches paths.ts's
// `slugify`, which has the same issue for URL slugs).
export function slugifyForHashtag(title: string): string {
  const ascii = title
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '');
  const words = ascii.match(/[a-zA-Z0-9]+/g) ?? [];
  const pascalCase = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return `#${pascalCase || 'HorrorStory'}`;
}

export async function renderYoutubeDescription(input: {
  title: string;
  teaser: string;
  storyHashtag: string;
}): Promise<string> {
  const template = await loadTemplate();
  return template
    .replaceAll('{{title}}', input.title)
    .replaceAll('{{storyTitleCaps}}', input.title.toLocaleUpperCase('vi-VN'))
    .replaceAll('{{teaser}}', input.teaser)
    .replaceAll('{{storyHashtag}}', input.storyHashtag);
}
