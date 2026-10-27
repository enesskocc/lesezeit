// Reading text display (spec "Display settings": font size, line height, serif/sans). Dark mode
// follows the system (Enes, 2026-10-27), so there is no theme setting.
import type { CSSProperties } from 'react';
import type { Prefs } from './db';

export const READER_SIZES = [
  { px: 16, label: 'Küçük' },
  { px: 19, label: 'Normal' },
  { px: 22, label: 'Büyük' },
  { px: 25, label: 'Çok büyük' },
] as const;

export const READER_LEADINGS = [
  { value: 1.5, label: 'Sık' },
  { value: 1.75, label: 'Normal' },
  { value: 2.05, label: 'Geniş' },
] as const;

export const READER_FONTS = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
] as const;

export function readerLook(p: Pick<Prefs, 'readerSize' | 'readerLeading' | 'readerFont'>): CSSProperties {
  return {
    fontSize: `${p.readerSize}px`,
    lineHeight: p.readerLeading,
    fontFamily: p.readerFont === 'sans' ? 'var(--font-ui)' : 'var(--font-read)',
  };
}
