import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { db, DEFAULT_PREFS, getPrefs, setPrefs, type CardRow } from '../lib/db';
import { fold, MATCH_MIN } from '../lib/exercises';
import { restoreCard, todayCounts, type DeletedCard } from '../lib/review';
import { dueCounts, matchable } from '../lib/session';
import { formatInterval, phaseOf, type Phase } from '../lib/srs';

const LENGTHS: [number, string][] = [
  [5, '5 dk'],
  [10, '10 dk'],
  [20, '20 dk'],
  [0, 'Hepsi'],
];
export const PHASE_LABEL: Record<Phase, string> = { new: 'yeni', learning: 'öğreniliyor', young: 'genç', mature: 'olgun' };
const PHASE_CLASS: Record<Phase, string> = {
  new: 'bg-accent-soft text-accent', learning: 'bg-learn text-ink', young: 'bg-bg text-muted', mature: 'bg-bg text-good',
};

export function dueText(card: CardRow, now: number): string {
  return card.due <= now ? 'şimdi' : `${formatInterval(card.due - now)} sonra`;
}

/** "Kelimeler" tab: what is due, start a session, practise one exercise type, all cards. */
export function Vocab() {
  const navigate = useNavigate();
  const location = useLocation();
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const prefs = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  const today = useLiveQuery(() => todayCounts(), [cards], { newDone: 0, reviewsDone: 0 });
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [deleted, setDeleted] = useState<DeletedCard | null>((location.state as { deleted?: DeletedCard } | null)?.deleted ?? null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000); // due counts move on while the tab is open
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!deleted) return;
    navigate('.', { replace: true, state: null }); // the toast must not come back on reload
    const t = setTimeout(() => setDeleted(null), 6000);
    return () => clearTimeout(t);
  }, [deleted, navigate]);

  const sorted = useMemo(() => [...(cards ?? [])].sort((a, b) => a.due - b.due), [cards]);
  if (!cards) return <p className="text-muted">Yükleniyor…</p>;

  const due = dueCounts(cards, now, Math.max(0, prefs.newPerDay - today.newDone), Math.max(0, prefs.maxReviews - today.reviewsDone));
  const mature = cards.filter((c) => phaseOf(c.fsrs) === 'mature').length;
  const nextDue = cards.reduce((m, c) => (c.due > now ? Math.min(m, c.due) : m), Infinity);
  const tooFew = cards.filter(matchable).length < MATCH_MIN; // a matching round needs 5 pairs
  const q = fold(query);
  const shown = q ? sorted.filter((c) => fold(`${c.display} ${c.meaning_tr}`).includes(q)) : sorted;

  return (
    <>
      <h1 className="mb-3 font-read text-[26px] font-semibold">Kelimeler</h1>

      {cards.length === 0 ? (
        <p className="card text-muted">
          Henüz kart yok. Okurken bir kelimeye dokun ve <b className="text-ink">„+ Kartlara ekle“</b> de.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 text-center" data-testid="vocab-stats">
            {(
              [
                ['Tekrar', due.learning + due.reviews],
                ['Yeni', due.fresh],
                ['Olgun', mature],
                ['Toplam', cards.length],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="card px-1 py-2.5">
                <div className="text-[22px] font-semibold tabular-nums">{n}</div>
                <div className="text-xs text-muted">{label}</div>
              </div>
            ))}
          </div>

          <div className="card mt-3">
            <div className="label mb-2">Oturum süresi</div>
            <div className="flex gap-2" role="group" aria-label="Oturum süresi">
              {LENGTHS.map(([m, label]) => (
                <button
                  key={m}
                  className={`flex-1 rounded-[10px] border-2 py-2 text-sm font-semibold ${
                    prefs.sessionMinutes === m ? 'border-accent bg-accent-soft text-accent' : 'border-line'
                  }`}
                  aria-pressed={prefs.sessionMinutes === m}
                  onClick={() => void setPrefs({ sessionMinutes: m })}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="btn-primary mt-3 w-full"
              disabled={due.total === 0 || tooFew}
              onClick={() => navigate(`/kelimeler/oturum?dk=${prefs.sessionMinutes}`)}
            >
              {tooFew ? 'En az 5 kart gerekli' : due.total ? `Oturumu başlat · ${due.total} kart` : 'Şimdilik tekrar yok'}
            </button>
            <p className="mt-2 text-center text-sm text-muted">
              {tooFew
                ? 'Eşleştirme turu 5–6 çiftle oynanır. Okurken birkaç kelime daha ekle.'
                : due.total === 0 && Number.isFinite(nextDue)
                  ? `Sıradaki tekrar ${formatInterval(nextDue - now)} sonra.`
                  : 'Süre bitince ya da „Bitir“e basınca özet görünür.'}
            </p>
          </div>

          <div className="mt-3">
            <button className="btn w-full" disabled={tooFew} onClick={() => navigate('/kelimeler/oturum?serbest=1')}>
              Serbest eşleştirme
            </button>
            <p className="mt-1.5 text-center text-xs text-muted">İstediğin zaman, tüm kartlarla. Yeni ya da vadesi gelmemiş kartların takvimi değişmez.</p>
          </div>

          <input
            className="field mt-4"
            type="search"
            placeholder="Kartlarda ara"
            aria-label="Kartlarda ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="mt-2 flex flex-col gap-1.5" aria-label="Kartlar">
            {shown.map((c) => {
              const phase = phaseOf(c.fsrs);
              return (
                <li key={c.id}>
                  <Link to={`/kart/${encodeURIComponent(c.id)}`} className="card flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-read font-semibold" lang="de">
                        {c.display}
                      </div>
                      <div className="truncate text-sm text-muted">{c.meaning_tr}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${PHASE_CLASS[phase]}`}>{PHASE_LABEL[phase]}</span>
                      <div className="mt-0.5 text-xs text-muted tabular-nums">{dueText(c, now)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {deleted && (
        <div
          role="status"
          className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-[10px] bg-ink px-3.5 py-2 text-[13.5px] text-bg"
        >
          <span>
            <span lang="de">{deleted.card.display}</span> silindi
          </span>
          <button
            className="font-semibold underline"
            onClick={() => {
              void restoreCard(deleted);
              setDeleted(null);
            }}
          >
            Geri al
          </button>
        </div>
      )}
    </>
  );
}
