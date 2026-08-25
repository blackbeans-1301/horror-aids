// Thumbnail image-gen prompts always ship with a trailing sentence naming the
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

export function composeThumbnailPrompt(prompt: string, title: string): string {
  const body = stripHighlightText(prompt).trim();
  const highlight = title.trim();
  if (!highlight) {
    return body;
  }
  if (!body) {
    return highlightTextLine(highlight);
  }
  return `${body}\n\n${highlightTextLine(highlight)}`;
}
