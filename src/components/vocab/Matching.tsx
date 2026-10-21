import { useEffect, useRef, useState } from 'react';
import { MATCH_MODE_LABEL, shuffle, type MatchMode, type Pair } from '../../lib/exercises';
import { Feedback, useElapsed, useSay, type OnDone } from './common';

type Side = 'l' | 'r';

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * Spec "Matching": 5–6 pairs, tap to match, timed. Every German tile speaks when selected. A pair
 * that was matched wrongly at least once counts as wrong (Again) for its card.
 */
export function Matching({ pairs, mode, onDone }: { pairs: Pair[]; mode: MatchMode; onDone: OnDone }) {
  const say = useSay();
  const elapsed = useElapsed();
  const [order] = useState(() => ({ l: shuffle(pairs), r: shuffle(pairs) }));
  const [selected, setSelected] = useState<{ side: Side; id: string } | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [wrong, setWrong] = useState<{ l: string; r: string } | null>(null);
  const [finishedMs, setFinishedMs] = useState<number | null>(null);
  const [, tick] = useState(0);
  const mistakes = useRef(new Map<string, number>());
  const wrongTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (finishedMs !== null) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [finishedMs]);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  const tap = (side: Side, p: Pair) => {
    if (matched.has(p.id) || wrong) return;
    if (side === 'l' || p.rightLang === 'de') say(side === 'l' ? p.left : p.right);
    if (!selected || selected.side === side) {
      setSelected({ side, id: p.id });
      return;
    }
    if (selected.id === p.id) {
      const next = new Set(matched).add(p.id);
      setMatched(next);
      setSelected(null);
      if (next.size === pairs.length) setFinishedMs(elapsed());
      return;
    }
    // The first tile's pair is the one that was not known.
    mistakes.current.set(selected.id, (mistakes.current.get(selected.id) ?? 0) + 1);
    setWrong(side === 'l' ? { l: p.id, r: selected.id } : { l: selected.id, r: p.id });
    setSelected(null);
    wrongTimer.current = setTimeout(() => setWrong(null), 650);
  };

  const tile = (side: Side, p: Pair) => {
    const done = matched.has(p.id);
    const isSel = selected?.side === side && selected.id === p.id;
    const isWrong = wrong?.[side] === p.id;
    const german = side === 'l' || p.rightLang === 'de';
    return (
      <button
        key={p.id}
        lang={german ? 'de' : 'tr'}
        disabled={done}
        aria-pressed={isSel}
        data-side={side}
        onClick={() => tap(side, p)}
        className={`min-h-[52px] rounded-[10px] border-2 bg-surface px-2 py-2 text-left text-[15px] leading-snug ${german ? 'font-read' : ''} ${
          done ? 'border-good text-good opacity-60' : isWrong ? 'border-bad bg-bad/10' : isSel ? 'border-accent bg-accent-soft' : 'border-line'
        }`}
      >
        {side === 'l' ? p.left : p.right}
      </button>
    );
  };

  const errors = [...mistakes.current.values()].reduce((a, b) => a + b, 0);
  const finish = () =>
    onDone(
      pairs.flatMap((p) => {
        if (!p.cardId) return []; // filler pair: not a card, nothing to schedule
        const ok = !mistakes.current.get(p.id);
        return [{ cardId: p.cardId, rating: ok ? 3 : 1, correct: ok, ms: (finishedMs ?? 0) / pairs.length }];
      }),
    );

  return (
    <div data-testid="ex-match">
      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        <span className="label">{MATCH_MODE_LABEL[mode]}</span>
        <span className="tabular-nums" aria-label="Süre">
          {clock(finishedMs ?? elapsed())}
        </span>
      </div>
      <p className="sr-only" role="status">
        {wrong ? 'Yanlış eşleşme' : ''}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">{order.l.map((p) => tile('l', p))}</div>
        <div className="flex flex-col gap-2">{order.r.map((p) => tile('r', p))}</div>
      </div>
      {finishedMs !== null && (
        // The round as a whole: "Neredeyse" with a few mistakes; each mistaken card is still rated Again.
        <Feedback correct={errors < pairs.length} partial={errors > 0} onNext={finish}>
          <p className="text-sm">
            Süre {clock(finishedMs)} · {errors ? `${errors} hata` : 'hatasız'}
          </p>
        </Feedback>
      )}
    </div>
  );
}
