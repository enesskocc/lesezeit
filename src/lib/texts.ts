import { TextFileSchema, TextIndexSchema, type TextFile, type TextIndex } from '../../shared/texts';
import { readDataJson } from './github';

/** texts/index.json from lesezeit-data (newest first). A repo without texts yet gives an empty list. */
export async function loadIndex(token: string): Promise<TextIndex> {
  try {
    return TextIndexSchema.parse(await readDataJson(token, 'texts/index.json'));
  } catch (e) {
    if (e instanceof Error && 'status' in e && e.status === 404) return { version: 1, updatedAt: '', texts: [] };
    throw e;
  }
}

export async function loadText(token: string, date: string, id: string): Promise<TextFile> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9]{6,40}$/.test(id)) throw new Error('Geçersiz metin adresi.');
  const parsed = TextFileSchema.safeParse(await readDataJson(token, `texts/${date}/${id}.json`));
  if (!parsed.success) throw new Error('Metin dosyası beklenen biçimde değil.');
  return parsed.data;
}

/** ~180 words per minute: a careful B2–C1 reading pace for a non-native reader. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 180));
