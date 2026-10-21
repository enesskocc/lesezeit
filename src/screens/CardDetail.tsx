import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Spoken } from '../components/vocab/common';
import { WordCard } from '../components/WordCard';
import { db } from '../lib/db';
import { deleteCard } from '../lib/review';
import { phaseOf } from '../lib/srs';
import { dueText, PHASE_LABEL } from './Vocab';

/** One card: meaning, schedule, dictionary data and every sentence it was saved from (with a link back). */
export function CardDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const card = useLiveQuery(() => db.cards.get(id), [id], null);

  if (card === null) return null;
  if (!card) {
    return (
      <>
        <Link to="/kelimeler" className="text-sm text-muted">
          ← Kelimeler
        </Link>
        <p className="mt-3 text-muted">Bu kart yok.</p>
      </>
    );
  }

  const now = Date.now();
  return (
    <>
      <Link to="/kelimeler" className="text-sm text-muted">
        ← Kelimeler
      </Link>
      <div className="card mt-3">
        <Spoken text={card.display} className="font-read text-[26px] leading-tight font-semibold" />
        <div className="mt-1 text-lg">{card.meaning_tr}</div>
        <p className="mt-2 text-sm text-muted tabular-nums" data-testid="card-schedule">
          {PHASE_LABEL[phaseOf(card.fsrs)]} · sıradaki tekrar {dueText(card, now)} · {card.fsrs.reps} tekrar
          {card.fsrs.lapses > 0 && ` · ${card.fsrs.lapses} kez unutuldu`}
        </p>
      </div>

      {card.entry && (
        <div className="mt-3">
          <WordCard entry={card.entry} />
        </div>
      )}

      <h2 className="label mt-4 mb-2">Geçtiği cümleler</h2>
      <ul className="flex flex-col gap-2">
        {card.contexts.map((ctx) => (
          <li key={`${ctx.textId}:${ctx.s}`} className="card">
            <p className="font-read leading-relaxed" lang="de">
              {ctx.sentence}
            </p>
            <Link to={`/oku/${ctx.date}/${ctx.textId}`} className="mt-1 inline-block text-sm text-accent underline">
              Metne git ({ctx.date})
            </Link>
          </li>
        ))}
      </ul>

      <button
        className="btn mt-5 text-bad"
        onClick={async () => {
          const deleted = await deleteCard(card.id);
          navigate('/kelimeler', { state: { deleted } });
        }}
      >
        Kartı sil
      </button>
    </>
  );
}
