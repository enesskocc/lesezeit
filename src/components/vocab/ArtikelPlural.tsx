import { useState } from 'react';
import type { CardRow } from '../../lib/db';
import { articleOf, checkPlural, pluralOf, type Outcome } from '../../lib/exercises';
import { phaseOf, ratingFor } from '../../lib/srs';
import { Feedback, TypeAnswer, useElapsed, useSay, type OnDone } from './common';

const ARTICLES = ['der', 'die', 'das'] as const;
const COLOR = { der: 'text-der', die: 'text-die', das: 'text-das' } as const;

/** Spec "Artikel & Plural": pick der/die/das, then type the plural. A wrong article = Again; right article but wrong plural = Hard. */
export function ArtikelPlural({ card, onDone }: { card: CardRow; onDone: OnDone }) {
  const say = useSay();
  const elapsed = useElapsed();
  const article = articleOf(card)!;
  const plural = pluralOf(card);
  const [picked, setPicked] = useState<string | null>(null);
  const [pl, setPl] = useState<Outcome | null>(null);
  const [ms, setMs] = useState(0);
  const finished = picked !== null && (!plural || pl !== null);
  const right = picked === article;
  const plWrong = !!pl && (!pl.correct || !!pl.partial);

  const pick = (a: string) => {
    setPicked(a);
    say(`${article} ${card.lemma}`); // spec: the noun with its article after answering
    if (!plural) setMs(elapsed());
  };

  return (
    <div data-testid="ex-artikel" data-card={card.id}>
      <div className="card text-center">
        <div className="font-read text-[30px] font-semibold" lang="de">
          {picked ? <span className={COLOR[article]}>{article} </span> : '… '}
          {card.lemma}
        </div>
        <div className="text-muted">{card.meaning_tr}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Artikel">
        {ARTICLES.map((a) => (
          <button
            key={a}
            lang="de"
            disabled={picked !== null}
            onClick={() => pick(a)}
            className={`rounded-[10px] border-2 bg-surface py-3 font-read text-lg font-semibold ${COLOR[a]} ${
              picked === null ? 'border-line' : a === article ? 'border-good' : a === picked ? 'border-bad' : 'border-line opacity-50'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      {picked !== null && plural && pl === null && (
        <TypeAnswer
          label="Çoğul"
          prefix="die"
          onSubmit={(v) => {
            setPl(checkPlural(v, card));
            setMs(elapsed());
          }}
        />
      )}
      {finished && (
        <Feedback
          correct={right}
          partial={right && plWrong}
          onNext={() => {
            const rating = ratingFor({ correct: right, partial: plWrong, ms }, phaseOf(card.fsrs), plural ? 'typing' : 'choice');
            onDone([{ cardId: card.id, rating, correct: right, ms }]);
          }}
        >
          <p className="font-read" lang="de">
            {article} {card.lemma}
            {plural && ` · die ${plural}`}
          </p>
          {!right && <p className="text-sm">Senin seçimin: {picked}</p>}
          {pl && !pl.correct && <p className="text-sm">Çoğul doğru değildi.</p>}
          {pl?.note && <p className="text-sm">{pl.note}</p>}
        </Feedback>
      )}
    </div>
  );
}
