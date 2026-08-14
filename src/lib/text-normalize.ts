// Mirrors _VN_LOWER / speaker_pattern in workers/process_story.py — that
// worker splits dialogue from narration by matching "Name: line" at the
// start of a line, so the colon in that specific position must survive
// normalization below or every character's lines collapse into narration.
const VN_LOWER =
  'aàáảãạăằắẳẵặâầấẩẫậ' +
  'eèéẻẽẹêềếểễệ' +
  'iìíỉĩị' +
  'oòóỏõọôồốổỗộơờớởỡợ' +
  'uùúủũụưừứửữự' +
  'yỳýỷỹỵ' +
  'dđ';
const VN_UPPER = VN_LOWER.toUpperCase();
const VN_LETTERS = VN_LOWER + VN_UPPER;
// A "word" for the lowercasing pass below: letters only (Vietnamese or
// plain ASCII), no digits/punctuation attached — checking case-purity on a
// unit that includes trailing punctuation would never look "pure ASCII" for
// a word right before a comma/period anyway, since punctuation isn't a letter.
const WORD_RE = new RegExp(`[A-Za-z${VN_LETTERS}]+`, 'g');
// A word made up entirely of plain ASCII letters, no Vietnamese diacritic.
// This is the only signal available for "is this word Vietnamese or
// foreign" — it's an imperfect proxy (a handful of real Vietnamese words,
// e.g. "quay", "ngay", "xin", carry no diacritic and are indistinguishable
// from English by this test alone), which is what SHOUT_RUN_RE below exists
// to cover for the case that matters: a diacritic-free Vietnamese word
// trapped inside an otherwise-obviously-Vietnamese shouted clause.
const ASCII_ONLY_RE = /^[A-Za-z]+$/;
// A single ALL-CAPS word, Vietnamese or ASCII letters. Two or more of these
// in a row (single-space separated) is treated as a shouted clause and
// lowercased wholesale — this is what catches "QUAY"/"NGAY" in "... KHÔNG
// ĐƯỢC QUAY ĐẦU LẠI" or "DỪNG LẠI NGAY!": those words carry no diacritic of
// their own, but sitting inside a run of otherwise-clearly-Vietnamese
// ALL-CAPS words is a strong enough signal that they aren't a standalone
// foreign acronym like "CIA" (which never appears glued to a run of other
// ALL-CAPS words).
const ALL_CAPS_WORD = `[A-Z${VN_UPPER}]+`;
const SHOUT_RUN_RE = new RegExp(`${ALL_CAPS_WORD}(?: ${ALL_CAPS_WORD})+`, 'g');
const SPEAKER_LINE_RE = new RegExp(`^([A-Za-z${VN_LETTERS}][A-Za-z0-9${VN_LETTERS} _-]{1,40})\\s*:\\s*(.+)$`);
// Digits only, no letters — a letters-based placeholder would survive the
// blanket lowercasing pass below unscathed either way, but staying
// letter-free keeps it unambiguous from real text at a glance.
const SPEAKER_COLON_PLACEHOLDER = '90210';

/**
 * Normalizes raw story/segment text so the TTS engine reads it cleanly:
 * - strips punctuation/markdown marks that TTS engines mis-read (colons,
 *   semicolons, separator dashes, ellipses, stray markdown symbols,
 *   parenthesis/bracket/brace delimiters, keeping their content)
 * - collapses repeated ?/! runs to a single mark
 * - lowercases every Vietnamese word in the text except the first letter of
 *   each sentence — not just ALL-CAPS runs, and not just shouted clauses. Any
 *   capitalization the TTS engine wasn't expecting (a shouted clause, a
 *   capitalized proper name like "Nguyễn Hữu Phước") reads as a
 *   pronunciation glitch, so there is no "leave Vietnamese proper nouns
 *   alone" exception — that's a deliberate product decision, not an
 *   oversight. English/foreign words (plain ASCII letters, no Vietnamese
 *   diacritic — "CIA", a foreign name) are read correctly as typed and are
 *   left exactly as written.
 *
 * Applied at every story-text ingestion point (library import, manual
 * create, save draft, sync-from-library, segment edits) so no path can
 * bypass it.
 */
export function normalizeStoryText(text: string): string {
  let result = text.normalize('NFC');

  // Protect "Name: line" speaker markers before the colon->comma step below.
  result = result
    .split('\n')
    .map((line) => {
      const match = line.match(SPEAKER_LINE_RE);
      if (!match) return line;
      const colonIndex = line.indexOf(':');
      return `${line.slice(0, colonIndex)}${SPEAKER_COLON_PLACEHOLDER}${line.slice(colonIndex + 1)}`;
    })
    .join('\n');

  // Strip parenthesis/bracket/brace delimiters but keep the content inside —
  // dropping the content too (old behavior) lost real detail in some stories.
  result = result.replace(/[()[\]{}]/g, '');

  result = result
    // stray markdown/formatting symbols
    .replace(/[*_~`#•]+/g, '')
    // blockquote markers at line start
    .replace(/^>+\s*/gm, '')
    // ellipsis (ascii run or unicode char) -> period
    .replace(/\.{2,}|…/g, '.')
    // dash used as a clause separator (spaces on both sides) -> comma
    .replace(/(\S)[ \t]*[-–—]+[ \t]+(?=\S)/g, '$1, ')
    // colon / semicolon -> comma (speaker-marker colons are protected above)
    .replace(/[:;]/g, ',')
    // repeated ?/! runs -> single mark
    .replace(/([!?])[!?]+/g, '$1')
    // no space before punctuation
    .replace(/[ \t]+([,.!?])/g, '$1')
    // collapse doubled punctuation left over from the replacements above
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/\.(?:\s*\.)+/g, '.')
    .replace(/,\s*\./g, '.')
    // ensure a space after punctuation when glued to the next word
    .replace(/([,.!?])(?=[^\s\d)"'”’])/g, '$1 ')
    // collapse horizontal whitespace runs
    .replace(/[ \t]+/g, ' ');

  result = result
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // First: lowercase whole shouted clauses (2+ consecutive ALL-CAPS words),
  // which also takes care of any diacritic-free Vietnamese word caught up in
  // one ("QUAY" inside "... KHÔNG ĐƯỢC QUAY ĐẦU LẠI").
  result = result.replace(SHOUT_RUN_RE, (run) => run.toLowerCase());

  // Then: lowercase every remaining word that carries a Vietnamese
  // diacritic, wherever it sits — a mid-sentence proper name like "Nguyễn
  // Hữu Phước" is exactly as much of a TTS pronunciation glitch as a shouted
  // clause, so there is no "leave Vietnamese proper nouns alone" exception.
  // Whatever's left standing at this point (a standalone plain-ASCII word,
  // not part of a shout run above) is assumed foreign — "CIA", "New York" —
  // and is left exactly as written.
  result = result.replace(WORD_RE, (word) => (ASCII_ONLY_RE.test(word) ? word : word.toLowerCase()));

  result = splitIntoSentenceChunks(result)
    .map(capitalizeFirstLetter)
    .join('');

  result = result.split(SPEAKER_COLON_PLACEHOLDER).join(':');

  return result.trim();
}

function splitIntoSentenceChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '.' || char === '!' || char === '?' || char === '\n') {
      chunks.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }

  if (start < text.length) {
    chunks.push(text.slice(start));
  }

  return chunks;
}

function capitalizeFirstLetter(text: string): string {
  const index = text.search(/\p{L}/u);
  if (index === -1) {
    return text;
  }
  return text.slice(0, index) + text[index].toUpperCase() + text.slice(index + 1);
}
