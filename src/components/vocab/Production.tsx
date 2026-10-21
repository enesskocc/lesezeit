import { useState } from 'react';
import type { CardRow } from '../../lib/db';
import { articleOf, checkProduction, type Outcome } from '../../lib/exercises';
import { phaseOf, ratingFor } from '../../lib/srs';
import { Feedback, grammarLine, TypeAnswer, useElapsed, useSay, type OnDone } from './common';

/** Spec "Production": Turkish meaning shown, type the German word with article. Right word, wrong article = Hard. */
export function Production({ card, onDone }: { card: CardRow; onDone: OnDone }) {
  const say = useSay();
  const elapsed = useElapsed();
  const [out, setOut] = useState<Outcome | null>(null);
  const [ms, setMs] = useState(0);
  const noun = !!articleOf(card);
  const task = noun ? 'İsim: artikeliyle yaz' : card.kind === 'mwe' ? 'İfadenin tamamını yaz' : 'Almancasını yaz';

  return (
    <div data-testid="ex-production" data-card={card.id}>
      <div className="card">
        <div className="text-[22px] leading-snug font-semibold">{card.meaning_tr}</div>
        <div className="mt-1 text-sm text-muted">{task}</div>
      </div>
      {!out ? (
        <TypeAnswer
          label="Almancası"
          onSubmit={(v) => {
            setOut(checkProduction(v, card));
            setMs(elapsed());
            say(card.display);
          }}
        />
      ) : (
        <Feedback
          correct={out.correct}
          partial={out.partial}
          onNext={() =>
            onDone([{ cardId: card.id, rating: ratingFor({ ...out, ms }, phaseOf(card.fsrs), 'typing'), correct: out.correct, ms }])
          }
        >
          <p className="font-read" lang="de">
            {grammarLine(card) ?? card.display}
          </p>
          {out.note && <p className="text-sm">{out.note}</p>}
        </Feedback>
      )}
    </div>
  );
}
