import { useEffect, useMemo, useRef, useState } from 'react';
import { ARTICLE } from '../../../shared/dict';
import type { CardRow } from '../../lib/db';
import { lookup } from '../../lib/dict';
import { familyOf } from '../../lib/exercises';
import { phaseOf, ratingFor } from '../../lib/srs';
import { Feedback, Spoken, useSay, type OnDone } from './common';
import { Flashcard } from './Flashcard';

const CHECK_MS = 2500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/**
 * Spec "Word family": base word, one derived form with 4 options (3 invented with wrong suffixes),
 * then the whole family with Turkish meanings and the suffix rule. Before showing the options,
 * each invented form is looked up: if the dictionary knows it, it is replaced (offline: skipped).
 */
export function WordFamily({ card, known, onDone }: { card: CardRow; known: ReadonlySet<string>; onDone: OnDone }) {
  const say = useSay();
  // Answer time starts when the options appear, not while the dictionary check is still running.
  const shownAt = useRef(0);
  const [real, setReal] = useState<Set<string>>(() => new Set());
  const [checked, setChecked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [meanings, setMeanings] = useState<Map<string, string>>(() => new Map());
  const pick = card.fsrs.reps + card.fsrs.lapses;
  const family = useMemo(() => familyOf(card, pick, new Set([...known, ...real])), [card, pick, known, real]);

  const show = () => {
    shownAt.current = Date.now();
    setChecked(true);
  };

  useEffect(() => {
    if (!family || checked) return;
    let cancelled = false;
    const invented = family.options.filter((o) => o !== family.target.word);
    withTimeout(Promise.all(invented.map((w) => lookup(w).then((hits) => (hits.length ? w : null), () => null))), CHECK_MS)
      .then((found) => {
        if (cancelled) return;
        const hits = found.filter((w): w is string => !!w);
        if (hits.length) setReal((prev) => new Set([...prev, ...hits]));
        else show();
      })
      .catch(() => !cancelled && show());
    return () => {
      cancelled = true;
    };
  }, [family, checked]);

  // After answering: Turkish meanings of the family members (best effort, online dictionary).
  useEffect(() => {
    if (!picked || !family) return;
    let cancelled = false;
    void Promise.all(
      family.members.map(async (m) => {
        const hits = await lookup(m.word).catch(() => []);
        const e = hits.find((h) => h.entry.w === m.word)?.entry ?? hits[0]?.entry;
        return [m.word, e?.tr?.[0] ?? (m.word === card.lemma ? card.meaning_tr : '')] as const;
      }),
    ).then((rows) => !cancelled && setMeanings(new Map(rows.filter(([, tr]) => tr))));
    return () => {
      cancelled = true;
    };
  }, [picked, family, card]);

  // Not enough invented forms left (all turned out to be real words): fall back to a flashcard.
  if (!family) return <Flashcard card={card} direction="tr" onDone={onDone} />;
  if (!checked) return <p className="text-muted">Hazırlanıyor…</p>;

  const right = picked === family.target.word;
  return (
    <div data-testid="ex-family" data-card={card.id}>
      <div className="card text-center">
        <Spoken text={family.base} className="font-read text-[26px] font-semibold" />
        <div className="mt-1 font-read text-lg text-muted" lang="de">
          → {family.prompt}
        </div>
        <div className="text-sm text-muted">{card.meaning_tr}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Seçenekler">
        {family.options.map((o) => (
          <button
            key={o}
            lang="de"
            disabled={picked !== null}
            onClick={() => {
              setPicked(o);
              setMs(Date.now() - shownAt.current);
              say(family.target.word);
            }}
            className={`rounded-[10px] border-2 bg-surface px-2 py-3 font-read text-[16px] ${
              picked === null ? 'border-line' : o === family.target.word ? 'border-good' : o === picked ? 'border-bad' : 'border-line opacity-50'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <Feedback
          correct={right}
          onNext={() => onDone([{ cardId: card.id, rating: ratingFor({ correct: right, ms }, phaseOf(card.fsrs), 'choice'), correct: right, ms }])}
        >
          <p className="text-sm">{family.target.suffix.rule}</p>
          <ul className="mt-2 flex flex-col gap-1" aria-label="Kelime ailesi">
            {family.members.map((m) => (
              <li key={m.word} className="flex justify-between gap-3 text-sm">
                <span lang="de" className={`font-read ${m.word === family.target.word ? 'font-semibold' : ''}`}>
                  {m.suffix?.g ? `${ARTICLE[m.suffix.g]} ` : ''}
                  {m.word}
                </span>
                <span className="text-muted">{meanings.get(m.word) ?? ''}</span>
              </li>
            ))}
          </ul>
        </Feedback>
      )}
    </div>
  );
}
