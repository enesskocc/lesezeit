// Saving answers: FSRS update + review log + word colour, in one transaction per card.
import type { MweLike } from './exercises';
import { db, type CardRow, type ReviewLogRow, type WordStatusRow } from './db';
import { mweKey } from './words';
import { dayStart, phaseOf, schedule, type Grade4 } from './srs';

/**
 * Records one answered exercise. Practice answers (drill on a card that is not due) are logged
 * but leave the schedule alone. A card that reaches the mature stage reads as "known" in the
 * reader; a lapse makes it "learning" (yellow) again.
 */
export async function recordReview(
  cardId: string, rating: Grade4, exercise: string, ms: number, practice: boolean, now = new Date(),
): Promise<CardRow | undefined> {
  return db.transaction('rw', db.cards, db.reviewLog, db.wordStatus, async () => {
    const card = await db.cards.get(cardId);
    if (!card) return undefined;
    const log: ReviewLogRow = { cardId, at: now.toISOString(), rating, exercise, ms: Math.round(ms), stateBefore: card.fsrs.state };
    if (practice) {
      await db.reviewLog.add({ ...log, practice: true });
      return card;
    }
    const fsrs = schedule(card.fsrs, now, rating);
    const updated: CardRow = { ...card, fsrs, due: Date.parse(fsrs.due) };
    await db.cards.put(updated);
    await db.reviewLog.add({ ...log, dueAfter: updated.due });
    const status = await db.wordStatus.get(cardId);
    const state = phaseOf(fsrs) === 'mature' ? 'known' : 'learning';
    if (status?.state !== 'ignored' && status?.state !== state) {
      await db.wordStatus.put({ key: cardId, state, updatedAt: now.toISOString() });
    }
    return updated;
  });
}

/** Today's answers (from 04:00), for the daily limits: new cards started and reviews done. */
export async function todayCounts(now = new Date()): Promise<{ newDone: number; reviewsDone: number }> {
  const rows = await db.reviewLog.where('at').aboveOrEqual(dayStart(now).toISOString()).toArray();
  const newCards = new Set(rows.filter((r) => !r.practice && r.stateBefore === 0).map((r) => r.cardId));
  return { newDone: newCards.size, reviewsDone: rows.filter((r) => !r.practice && r.stateBefore === 2).length };
}

/**
 * What a session needs besides the cards: expressions from downloaded texts (matching fillers,
 * Enes 2026-10-21) and every real word we know of (never offered as an invented family form).
 */
export async function sessionExtras(cards: CardRow[]): Promise<{ mwes: MweLike[]; known: Set<string> }> {
  const saved = new Set(cards.map((c) => c.id));
  const mwes: MweLike[] = [];
  const seen = new Set<string>();
  await db.textCache.each((row) => {
    for (const m of row.text.mwes ?? []) {
      const key = mweKey(m);
      if (saved.has(key) || seen.has(key)) continue;
      seen.add(key);
      mwes.push({ de: m.de, tr: m.tr, kind: m.kind });
    }
  });
  const known = new Set<string>();
  for (const c of cards) {
    known.add(c.lemma);
    for (const w of c.entry?.fam ?? []) known.add(w);
  }
  return { mwes, known };
}

export interface DeletedCard {
  card: CardRow;
  status?: WordStatusRow;
}

/** Deletes a card; the word becomes "new" again. Returns what is needed for "Geri al". */
export async function deleteCard(id: string): Promise<DeletedCard | undefined> {
  return db.transaction('rw', db.cards, db.wordStatus, async () => {
    const card = await db.cards.get(id);
    if (!card) return undefined;
    const status = await db.wordStatus.get(id);
    await db.cards.delete(id);
    await db.wordStatus.delete(id);
    return { card, status };
  });
}

export async function restoreCard(d: DeletedCard): Promise<void> {
  await db.transaction('rw', db.cards, db.wordStatus, async () => {
    await db.cards.put(d.card);
    if (d.status) await db.wordStatus.put(d.status);
  });
}
