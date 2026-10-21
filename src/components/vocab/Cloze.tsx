import { useMemo, useState } from 'react';
import type { CardRow } from '../../lib/db';
import { checkCloze, clozeOf, type Outcome } from '../../lib/exercises';
import { phaseOf, ratingFor } from '../../lib/srs';
import { Feedback, TypeAnswer, useElapsed, useSay, type OnDone } from './common';

/** Spec "Cloze in context": the original reading sentence with the word blanked; type it (lemma hint optional = Hard). */
export function Cloze({ card, onDone }: { card: CardRow; onDone: OnDone }) {
  const say = useSay();
  const elapsed = useElapsed();
  const cloze = useMemo(() => clozeOf(card)!, [card]);
  const [hint, setHint] = useState(false);
  const [out, setOut] = useState<Outcome | null>(null);
  const [ms, setMs] = useState(0);
  const gaps = cloze.answers.length;

  return (
    <div data-testid="ex-cloze" data-card={card.id}>
      <div className="card">
        <p className="font-read text-[19px] leading-[1.7]" lang="de" data-testid="cloze-sentence">
          {cloze.parts.map((p, k) =>
            typeof p === 'string' ? (
              <span key={k}>{p}</span>
            ) : out ? (
              <b key={k} className={out.correct ? 'text-good' : 'text-bad'}>
                {cloze.answers[p]}
              </b>
            ) : (
              <span key={k} className="inline-block min-w-[3.5em] border-b-2 border-accent text-center text-muted">
                {gaps > 1 ? p + 1 : ' '}
              </span>
            ),
          )}
        </p>
        <p className="mt-2 text-sm text-muted">
          Anlam: <span className="text-ink">{card.meaning_tr || '—'}</span>
          {hint && (
            <>
              {' '}
              · Kelime: <span lang="de" className="font-read text-ink">{card.display}</span>
            </>
          )}
        </p>
        {!hint && !out && (
          <button className="mt-1 text-sm text-accent underline" onClick={() => setHint(true)}>
            İpucu
          </button>
        )}
      </div>
      {!out ? (
        <TypeAnswer
          label={gaps > 1 ? `${gaps} boşluğu sırayla yaz` : 'Eksik kelime'}
          onSubmit={(v) => {
            setOut(checkCloze(v, cloze));
            setMs(elapsed());
            say(cloze.ctx.sentence); // spec: the full sentence once the gap is filled
          }}
        />
      ) : (
        <Feedback
          correct={out.correct}
          partial={out.partial || hint}
          onNext={() =>
            onDone([
              { cardId: card.id, rating: ratingFor({ ...out, hinted: hint, ms }, phaseOf(card.fsrs), 'typing'), correct: out.correct, ms },
            ])
          }
        >
          <p className="font-read" lang="de">
            {cloze.answers.join(' … ')}
          </p>
          {out.note && <p className="text-sm">{out.note}</p>}
        </Feedback>
      )}
    </div>
  );
}
