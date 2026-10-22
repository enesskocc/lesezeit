import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Answer } from '../components/vocab/common';
import { Matching } from '../components/vocab/Matching';
import { db, getPrefs, type CardRow } from '../lib/db';
import { recordReview, sessionExtras, todayCounts } from '../lib/review';
import { isRated, matchable, nextItem, recordItem, startSession, type Context, type Item, type SessionState } from '../lib/session';
import { stopSpeaking } from '../lib/speech';
import { formatInterval } from '../lib/srs';

interface Run {
  s: SessionState;
  ctx: Omit<Context, 'cards'> & { cards: CardRow[] }; // full rows: the card list after each round
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Spec "Session composer": matching rounds for 5 / 10 / 20 minutes or "all due" — or free practice (`?serbest=1`). */
export function Session() {
  const [params] = useSearchParams();
  const free = params.get('serbest') === '1';
  const minutes = Number(params.get('dk') ?? 10) || 0;
  const run = useRef<Run | null>(null);
  const [item, setItem] = useState<Item | null | undefined>(undefined); // undefined = loading
  const [stats, setStats] = useState({ answers: 0, correct: 0, fresh: 0 });
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const saving = useRef(false);
  const shownItem = useRef<Item | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cards, prefs, today] = await Promise.all([db.cards.toArray(), getPrefs(), todayCounts()]);
      const extras = await sessionExtras(cards);
      const now = Date.now();
      const s = startSession(
        {
          minutes: free ? 0 : minutes,
          newLeft: Math.max(0, prefs.newPerDay - today.newDone),
          reviewsLeft: Math.max(0, prefs.maxReviews - today.reviewsDone),
          free,
        },
        now,
      );
      const ctx = { cards, mwes: extras.mwes, rand: Math.random };
      if (cancelled) return;
      run.current = { s, ctx };
      const first = nextItem(s, ctx, now);
      shownItem.current = first;
      setItem(first);
      if (!first) setEnded(true);
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      stopSpeaking();
    };
  }, [free, minutes]);

  useEffect(() => {
    if (ended || free || !minutes) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ended, free, minutes]);

  const onDone = async (answers: Answer[]) => {
    const r = run.current;
    // A double tap must not record twice: a tap queued on the old exercise's button arrives with
    // the old `item` after the next one is already chosen.
    if (!r || !item || saving.current || shownItem.current !== item) return;
    saving.current = true;
    try {
      const before = new Map<string, CardRow['fsrs']['state']>();
      const results = new Map<string, boolean>();
      let fresh = 0;
      let reviews = 0;
      for (const a of answers) {
        const card = r.ctx.cards.find((c) => c.id === a.cardId);
        if (!card) continue;
        const now = new Date();
        const rated = isRated(r.s, card, now.getTime(), reviews);
        results.set(a.cardId, a.correct);
        if (rated) {
          before.set(a.cardId, card.fsrs.state);
          if (card.fsrs.state === 0 && !r.s.introduced.has(card.id)) fresh++;
          if (card.fsrs.state === 2) reviews++;
        }
        const updated = await recordReview(a.cardId, a.rating, 'match', a.ms, !rated, now);
        if (updated) r.ctx.cards = r.ctx.cards.map((c) => (c.id === updated.id ? updated : c));
      }
      recordItem(r.s, item, results, before);
      setStats((st) => ({
        answers: st.answers + answers.length,
        correct: st.correct + answers.filter((a) => a.correct).length,
        fresh: st.fresh + fresh,
      }));
      const next = nextItem(r.s, r.ctx, Date.now());
      shownItem.current = next;
      setItem(next);
      if (!next) setEnded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
    }
  };

  if (error) {
    return (
      <>
        <Link to="/kelimeler" className="text-sm text-muted">
          ← Kelimeler
        </Link>
        <p className="mt-3 text-bad" role="alert">
          {error}
        </p>
      </>
    );
  }
  if (item === undefined) return <p className="text-muted">Yükleniyor…</p>;

  const r = run.current!;
  if (ended || !item) {
    const now = Date.now();
    const nextDue = r.ctx.cards.filter((c) => c.due > now).reduce((min, c) => Math.min(min, c.due), Infinity);
    return (
      <div data-testid="session-summary">
        <h1 className="mb-2 font-read text-[24px] font-semibold">{stats.answers ? 'Oturum bitti' : 'Şu an tekrar yok'}</h1>
        {!stats.answers && !free && r.ctx.cards.filter(matchable).length < 5 && (
          <p className="text-sm text-muted">Eşleştirme için en az 5 kart gerekli. Okurken kelime ekle.</p>
        )}
        {stats.answers > 0 && (
          <p className="card tabular-nums">
            {stats.answers} cevap · %{Math.round((stats.correct / stats.answers) * 100)} doğru
            {stats.fresh > 0 && ` · ${stats.fresh} yeni kart`}
          </p>
        )}
        {Number.isFinite(nextDue) && <p className="mt-3 text-sm text-muted">Sıradaki tekrar {formatInterval(nextDue - now)} sonra.</p>}
        <Link to="/kelimeler" className="btn-primary mt-4 block text-center">
          Kelimelere dön
        </Link>
      </div>
    );
  }

  const left = minutes && !free ? Math.max(0, minutes * 60_000 - (Date.now() - r.s.startedAt)) : null;
  const exercise = <Matching pairs={item.pairs} mode={item.mode} onDone={onDone} />;

  return (
    <div data-testid="session">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="label flex-1">
          Eşleştirme
          {item.repeat && ' · tekrar'}
          {free && ' · serbest'}
        </span>
        {left !== null && (
          <span className="text-sm text-muted tabular-nums" aria-label="Kalan süre">
            {left > 0 ? clock(left) : 'son tekrarlar'}
          </span>
        )}
        <button className="btn py-1.5" onClick={() => setEnded(true)}>
          Bitir
        </button>
      </div>
      <div key={r.s.count} data-step={r.s.count}>
        {exercise}
      </div>
    </div>
  );
}
