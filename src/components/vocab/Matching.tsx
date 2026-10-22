import { Fragment, useEffect, useRef, useState } from 'react';
import { MATCH_MODE_LABEL, shuffle, type MatchMode, type Pair } from '../../lib/exercises';
import { canSpeak } from '../../lib/speech';
import { Feedback, speak, SpeakerIcon, useElapsed, type OnDone } from './common';

type Side = 'l' | 'r';

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * Spec "Matching": 5–6 pairs, tap to match, timed. Rows are aligned (German left, the other side
 * right). Tapping a tile only selects it; German tiles have their own 🔊 button (Enes 2026-10-22:
 * no sound on select). A pair matched wrongly at least once counts as wrong (Again) for its card and
 * is listed again at the end with its right partner.
 */
export function Matching({ pairs, mode, onDone }: { pairs: Pair[]; mode: MatchMode; onDone: OnDone }) {
  const elapsed = useElapsed();
  const voice = canSpeak();
  const [order] = useState(() => ({ l: shuffle(pairs), r: shuffle(pairs) }));
  const [selected, setSelected] = useState<{ side: Side; id: string } | null>(null);
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [pop, setPop] = useState<string | null>(null); // pair just matched (short scale-up)
  const [wrong, setWrong] = useState<{ l: string; r: string } | null>(null);
  const [finishedMs, setFinishedMs] = useState<number | null>(null);
  const [, tick] = useState(0);
  const mistakes = useRef(new Map<string, number>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (finishedMs !== null) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [finishedMs]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const tap = (side: Side, p: Pair) => {
    if (matched.has(p.id) || wrong) return;
    if (!selected || selected.side === side) {
      setSelected(selected?.side === side && selected.id === p.id ? null : { side, id: p.id }); // tap again = unselect
      return;
    }
    if (selected.id === p.id) {
      const next = new Set(matched).add(p.id);
      setMatched(next);
      setSelected(null);
      setPop(p.id);
      later(350, () => setPop(null));
      if (next.size === pairs.length) setFinishedMs(elapsed());
      return;
    }
    // The first tile's pair is the one that was not known.
    mistakes.current.set(selected.id, (mistakes.current.get(selected.id) ?? 0) + 1);
    setWrong(side === 'l' ? { l: p.id, r: selected.id } : { l: selected.id, r: p.id });
    setSelected(null);
    later(650, () => setWrong(null));
  };

  const tile = (side: Side, p: Pair) => {
    const done = matched.has(p.id);
    const isSel = selected?.side === side && selected.id === p.id;
    const isWrong = wrong?.[side] === p.id;
    const german = side === 'l' || p.rightLang === 'de';
    const text = side === 'l' ? p.left : p.right;
    const speaker = german && voice;
    const look = done
      ? 'border-good/50 bg-good/10 text-good'
      : isWrong
        ? 'shake border-bad bg-bad/10'
        : isSel
          ? 'border-accent bg-accent-soft shadow-sm'
          : 'border-line bg-surface';
    return (
      <div className="relative">
        <button
          lang={german ? 'de' : 'tr'}
          disabled={done}
          aria-pressed={isSel}
          data-side={side}
          onClick={() => tap(side, p)}
          className={`flex h-full min-h-[64px] w-full items-center rounded-xl border-2 py-2.5 pl-3 text-left text-[16px] leading-snug transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] ${
            speaker ? 'pr-12' : 'pr-3'
          } ${german ? 'font-read' : ''} ${pop === p.id ? 'scale-[1.04]' : ''} ${look}`}
        >
          {text}
        </button>
        {speaker && (
          // A sibling, not a child: a button inside a button is invalid and would also select the tile.
          <button
            type="button"
            aria-label={`${text}: dinle`}
            data-testid="match-speak"
            onClick={() => speak(text)}
            className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-accent-soft text-accent active:scale-95"
          >
            <SpeakerIcon className="size-5" />
          </button>
        )}
      </div>
    );
  };

  const errors = [...mistakes.current.values()].reduce((a, b) => a + b, 0);
  const missed = pairs.filter((p) => mistakes.current.get(p.id));
  const finish = () =>
    onDone(
      pairs.flatMap((p) => {
        if (!p.cardId) return []; // filler pair: not a card, nothing to schedule
        const ok = !mistakes.current.get(p.id);
        return [{ cardId: p.cardId, rating: ok ? (3 as const) : (1 as const), correct: ok, ms: (finishedMs ?? 0) / pairs.length }];
      }),
    );

  return (
    <div data-testid="ex-match">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{MATCH_MODE_LABEL[mode]}</span>
        <span className="text-sm text-muted tabular-nums" aria-label="İlerleme ve süre">
          {matched.size}/{pairs.length} · {clock(finishedMs ?? elapsed())}
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${(matched.size / pairs.length) * 100}%` }} />
      </div>
      <p className="sr-only" role="status">
        {wrong ? 'Yanlış eşleşme' : ''}
      </p>
      {/* One grid, row by row: the two tiles of a row always have the same height. */}
      <div className="grid grid-cols-2 gap-2.5">
        {order.l.map((p, i) => (
          <Fragment key={p.id}>
            {tile('l', p)}
            {tile('r', order.r[i]!)}
          </Fragment>
        ))}
      </div>
      {finishedMs === null && matched.size === 0 && !selected && (
        <p className="mt-3 text-center text-sm text-muted">Bir kelimeye, sonra onun eşine dokun.</p>
      )}
      {finishedMs !== null && (
        // The round as a whole: "Neredeyse" with a few mistakes; each mistaken card is still rated Again.
        <Feedback correct={errors < pairs.length} partial={errors > 0} onNext={finish}>
          <p className="text-sm text-muted">
            Süre {clock(finishedMs)} · {errors ? `${errors} hata` : 'hatasız'}
          </p>
          {missed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5" aria-label="Yanlış eşleştirdiklerin">
              {missed.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[15px]">
                  <span>
                    <b className="font-read" lang="de">
                      {p.left}
                    </b>{' '}
                    — <span lang={p.rightLang}>{p.right}</span>
                  </span>
                  {voice && (
                    <button
                      type="button"
                      aria-label={`${p.left}: dinle`}
                      onClick={() => speak(p.left)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                    >
                      <SpeakerIcon className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Feedback>
      )}
    </div>
  );
}
