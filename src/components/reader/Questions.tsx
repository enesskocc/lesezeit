import { useState } from 'react';
import type { Question } from '../../../shared/texts';

interface Props {
  questions: Question[];
  /** Highlight and scroll to the sentence that proves the answer. */
  onProof: (s: number) => void;
  onAnswered: (correct: number, answered: number) => void;
}

/** Spec "After reading" 1: comprehension questions with instant check + proof sentence. */
export function Questions({ questions, onProof, onAnswered }: Props) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});

  const answer = (q: Question, i: number) => {
    if (picked[q.id] !== undefined) return;
    const next = { ...picked, [q.id]: i };
    setPicked(next);
    onProof(q.proof);
    const graded = questions.filter((x) => x.type !== 'open' && next[x.id] !== undefined);
    onAnswered(graded.filter((x) => next[x.id] === x.answer).length, graded.length);
  };

  return (
    <section className="mt-6" aria-label="Anlama soruları">
      <div className="label">Anlama soruları</div>
      {questions.map((q, n) => {
        const p = picked[q.id];
        return (
          <div key={q.id} className="card mt-2.5" data-testid={`question-${q.id}`}>
            <p className="mb-2.5 font-semibold" lang="de">
              {n + 1}. {q.q}
            </p>
            {q.type === 'open' ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    setShown({ ...shown, [q.id]: true });
                    onProof(q.proof);
                  }}
                >
                  Örnek cevabı göster
                </button>
                {shown[q.id] && (
                  <div className="mt-2 text-sm">
                    <p lang="de" className="font-read">
                      {String(q.answer)}
                    </p>
                    <p className="mt-1 text-muted">{q.explain_tr}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {q.options?.map((o, i) => {
                    const state = p === undefined ? '' : i === q.answer ? 'ok' : i === p ? 'no' : '';
                    return (
                      <button
                        key={i}
                        disabled={p !== undefined}
                        onClick={() => answer(q, i)}
                        lang="de"
                        data-state={state || undefined}
                        className={`rounded-[9px] border px-2.5 py-2 text-left disabled:cursor-default ${
                          state === 'ok'
                            ? 'border-good bg-[color-mix(in_srgb,var(--good)_14%,var(--surface))]'
                            : state === 'no'
                              ? 'border-bad bg-[color-mix(in_srgb,var(--bad)_12%,var(--surface))]'
                              : 'border-line bg-bg'
                        }`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
                {p !== undefined && (
                  <p className="mt-2 text-[13px] text-muted" role="status">
                    <b className={p === q.answer ? 'text-good' : 'text-bad'}>{p === q.answer ? 'Doğru.' : 'Yanlış.'}</b> {q.explain_tr}{' '}
                    Kanıt cümlesi metinde işaretlendi.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
