import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TextFile } from '../../shared/texts';
import { loadText, readingMinutes } from '../lib/texts';

type State = { kind: 'loading' } | { kind: 'ok'; text: TextFile } | { kind: 'error'; message: string };

// Preview of a text (milestones 3–4): AI level with reasons, Turkish translation per sentence on
// tap. Tappable words, colours and the questions arrive with the real reader in milestone 5.
export function TextPreview({ token }: { token: string }) {
  const { date = '', id = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadText(token, date, id)
      .then((text) => !cancelled && setState({ kind: 'ok', text }))
      .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [token, date, id]);

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <>
      <div className="mb-3 flex items-center gap-2.5">
        <Link to="/" className="py-1 pr-1.5 text-xl text-muted" aria-label="Geri">
          ←
        </Link>
        {state.kind === 'ok' && (
          <span className="label">
            {state.text.level ?? state.text.levelHeuristic}
            {!state.text.level && ' (tahmini)'} · <span lang="de">{state.text.sourceName}</span>
          </span>
        )}
      </div>

      {state.kind === 'loading' && <p className="text-muted">Yükleniyor…</p>}
      {state.kind === 'error' && (
        <p className="text-bad" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'ok' && <Body text={state.text} open={open} toggle={toggle} />}
    </>
  );
}

function Body({ text, open, toggle }: { text: TextFile; open: Set<number>; toggle: (i: number) => void }) {
  const hasTr = text.sentences.some((s) => s.tr);
  return (
    <article lang="de">
      <h1 className="mb-1 font-read text-[22px] leading-tight font-semibold">{text.title}</h1>
      <p className="mb-3 text-[12.5px] text-muted tabular-nums" lang="tr">
        {text.wordCount} kelime · ~{readingMinutes(text.wordCount)} dk ·{' '}
        <a className="text-accent underline" href={text.url} target="_blank" rel="noreferrer">
          Original öffnen
        </a>
      </p>

      {text.levelAi && text.levelAi.confidence > 0 && (
        <div className="mb-3 rounded-[10px] bg-accent-soft px-3 py-2.5 text-sm" lang="tr" data-testid="level-reasons">
          <span className="font-semibold">Seviye {text.levelAi.level}:</span> {text.levelAi.reasons_tr}
        </div>
      )}
      {hasTr && (
        <p className="mb-2 text-[13px] text-muted" lang="tr">
          Çevirisini görmek için bir cümleye dokun.
        </p>
      )}

      <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-4 py-[18px] font-read text-[19px] leading-[1.75]">
        {text.paragraphs.map((_, p) => (
          <p key={p}>
            {text.sentences.map((s, i) =>
              s.p !== p ? null : (
                <span key={i}>
                  {s.tr ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-expanded={open.has(i)}
                      onClick={() => toggle(i)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(i))}
                      className={`cursor-pointer rounded ${open.has(i) ? 'bg-accent-soft' : ''}`}
                    >
                      {s.t}
                    </span>
                  ) : (
                    s.t
                  )}{' '}
                  {open.has(i) && s.tr && (
                    <span className="my-1 block rounded-lg bg-bg px-3 py-2 font-ui text-[15px] leading-snug text-ink" lang="tr">
                      {s.tr}
                      {s.notes?.map((n, j) => (
                        <span key={j} className="mt-1 block text-[13px] text-muted">
                          {n}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              ),
            )}
          </p>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-muted" lang="tr">
        Önizleme: kelimelere dokunma, renkler ve {text.questions?.length ? `${text.questions.length} anlama sorusu` : 'sorular'} 5. aşamada
        gelecek.
      </p>
    </article>
  );
}
