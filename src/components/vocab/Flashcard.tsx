import { useMemo, useState } from 'react';
import type { CardRow } from '../../lib/db';
import { formatInterval, previewIntervals, type Grade4 } from '../../lib/srs';
import { grammarLine, Spoken, useElapsed, useSay, type OnDone } from './common';

const BUTTONS: [Grade4, string, string][] = [
  [1, 'Tekrar', 'border-bad text-bad'],
  [2, 'Zor', 'border-line'],
  [3, 'İyi', 'border-good text-good'],
  [4, 'Kolay', 'border-accent text-accent'],
];

/** Spec "Flashcard": DE → TR or TR → DE, flip, self-rate (4 buttons with the next interval, Enes 2026-10-21). */
export function Flashcard({ card, direction, onDone }: { card: CardRow; direction: 'de' | 'tr'; onDone: OnDone }) {
  const say = useSay();
  const elapsed = useElapsed();
  const [shown, setShown] = useState(false);
  // FSRS fuzz depends on the review time: the answer is saved at the preview's time, so the
  // interval under the button is exactly the one stored.
  const [shownAt] = useState(() => Date.now());
  const intervals = useMemo(() => previewIntervals(card.fsrs, new Date(shownAt)), [card.fsrs, shownAt]);
  const ctx = card.contexts[0];
  const german = <Spoken text={card.display} className="font-read text-[28px] leading-tight font-semibold" />;
  const turkish = <div className="text-[22px] leading-snug font-semibold">{card.meaning_tr || '—'}</div>;
  const grammar = grammarLine(card);

  return (
    <div data-testid="ex-flash" data-card={card.id}>
      <div className="card min-h-[180px]">
        {direction === 'de' ? german : turkish}
        {shown && (
          <div className="mt-3 border-t border-line pt-3" data-testid="flash-back">
            {direction === 'de' ? turkish : german}
            {grammar && (
              <p className="mt-1 text-sm text-muted" lang="de">
                {grammar}
              </p>
            )}
            {ctx && (
              <p className="mt-2 font-read text-[15.5px] leading-relaxed" lang="de">
                {ctx.sentence}
              </p>
            )}
          </div>
        )}
      </div>
      {!shown ? (
        <button
          className="btn-primary mt-3 w-full"
          onClick={() => {
            setShown(true);
            if (direction === 'tr') say(card.display);
          }}
        >
          Göster
        </button>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Ne kadar iyi bildin?">
          {BUTTONS.map(([r, label, cls]) => (
            <button
              key={r}
              className={`rounded-[10px] border-2 bg-surface px-1 py-2 text-sm font-semibold ${cls}`}
              onClick={() =>
                // After a long pause (phone locked) the real time matters more than the exact preview.
                onDone([{ cardId: card.id, rating: r, correct: r > 1, ms: elapsed(), at: elapsed() < 60_000 ? shownAt : undefined }])
              }
            >
              {label}
              <span className="block text-xs font-normal text-muted tabular-nums">{formatInterval(intervals[r])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
