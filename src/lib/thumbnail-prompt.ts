// Thumbnail image-gen prompts always ship with a fixed lead-in phrase
// ("An ultra realistic image about ...") and a trailing sentence naming the
// text to burn into the thumbnail:
//
//   With highlight text "Nhật Ký Video Từ Quá Khứ: Chiếc Ổ Cứng Bị Nguyền Rủa"
//
// That text must be whichever title variant the operator currently has
// selected (including edits made after generation), so the line is composed
// at copy time from the live metadata rather than baked into the stored
// prompt body. Kept out of openai-metadata.ts (which is server-only) so the
// metadata UI can call it too.

// Tolerates the casing/quote drift a model produces ("With Highlight text",
// curly quotes, a trailing period) and repeats, so a prompt pasted back in
// with the line already attached doesn't end up with two of them.
const HIGHLIGHT_LINE_PATTERN = /\s*with\s+highlight\s+text\s*[:-]?\s*["“”'][^"“”']*["“”']\s*[.。]?\s*$/i;

export function stripHighlightText(prompt: string): string {
  let stripped = prompt;
  while (HIGHLIGHT_LINE_PATTERN.test(stripped)) {
    stripped = stripped.replace(HIGHLIGHT_LINE_PATTERN, '');
  }
  return stripped.trimEnd();
}

export function highlightTextLine(title: string): string {
  return `With highlight text "${title.trim()}"`;
}

// Every prompt must open with this so the image generator aims for a
// photograph rather than an illustration. Like the highlight sentence it is
// composed at copy time instead of stored, so it can never be lost to an
// operator edit or a model that forgot it.
export const ULTRA_REALISTIC_PREFIX = 'An ultra realistic image about';

// Tolerates the casing/spacing drift a model produces, and a prompt pasted
// back in with the prefix already attached, so copying twice doesn't stack
// two prefixes.
const ULTRA_REALISTIC_PREFIX_PATTERN = /^\s*an\s+ultra\s+realistic\s+image\s+about\s*[:,-]?\s*/i;

export function stripUltraRealisticPrefix(prompt: string): string {
  let stripped = prompt;
  while (ULTRA_REALISTIC_PREFIX_PATTERN.test(stripped)) {
    stripped = stripped.replace(ULTRA_REALISTIC_PREFIX_PATTERN, '');
  }
  return stripped.trimStart();
}

export function withUltraRealisticPrefix(prompt: string): string {
  const body = stripUltraRealisticPrefix(prompt).trim();
  return body ? `${ULTRA_REALISTIC_PREFIX} ${body}` : ULTRA_REALISTIC_PREFIX;
}

export function composeThumbnailPrompt(prompt: string, title: string): string {
  const body = withUltraRealisticPrefix(stripHighlightText(prompt).trim());
  const highlight = title.trim();
  if (!highlight) {
    return body;
  }
  return `${body}\n\n${highlightTextLine(highlight)}`;
}
