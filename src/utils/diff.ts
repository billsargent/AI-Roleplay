/**
 * Word-level diff for showing what AI Enhance changed.
 * Classic longest-common-subsequence over words (each with its trailing space).
 *
 * @module diff
 */

export interface DiffPart {
  text: string;
  /** 'same', 'added' (only in the new text) or 'removed' (only in the old text) */
  kind: 'same' | 'added' | 'removed';
}

/** Above this many tokens per side the diff is skipped (too slow to be worth it) */
const MAX_TOKENS = 3000;

/** Words with the spaces that follow them (leading spaces on their own) */
const tokenize = (s: string) => s.match(/^\s+|\S+\s*/g) || [];

/**
 * Differences between two texts by word. Returns null when the texts are
 * too long to compare quickly (show them side by side instead).
 */
export function diffWords(before: string, after: string): DiffPart[] | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // lcs[i][j] = common length of a[i..] and b[j..], stored flat
  const width = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++; }
    else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) { push(a[i], 'removed'); i++; }
    else { push(b[j], 'added'); j++; }
  }
  while (i < a.length) push(a[i++], 'removed');
  while (j < b.length) push(b[j++], 'added');
  return parts;
}
