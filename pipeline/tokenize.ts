// Deterministic tokenization. Claude annotates tokens by index, so the reader can always
// rebuild the exact sentence from the tokens and no annotation can drift to another word.
import type { Token } from '../shared/texts.ts';

// Words (incl. inner hyphens/apostrophes: "E-Mail", "geht's"), numbers ("2026", "3,5", "12:30"),
// and every other visible character as its own token (punctuation, quotes, dashes).
const TOKEN = /\p{L}[\p{L}\p{M}'’-]*|\d+(?:[.,:]\d+)*|\S/gu;

export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of sentence.matchAll(TOKEN)) {
    const s = m[0];
    tokens.push({
      i: tokens.length,
      s,
      ws: m.index > last, // anything between tokens is whitespace
      k: /^\p{L}/u.test(s) ? 'w' : /^\d/.test(s) ? 'n' : 'p',
    });
    last = m.index + s.length;
  }
  return tokens;
}

export function detokenize(tokens: Pick<Token, 's' | 'ws'>[]): string {
  return tokens.map((t, i) => (i > 0 && t.ws ? ' ' : '') + t.s).join('');
}

/** "0:Die 1:Stadt 2:hat …" — the numbered form Claude sees. Punctuation is shown but not annotated. */
export function numbered(tokens: Token[]): string {
  return tokens.map((t) => `${t.i}:${t.s}`).join(' ');
}
