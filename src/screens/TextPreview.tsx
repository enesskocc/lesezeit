import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TextFile } from '../../shared/texts';
import { loadText, readingMinutes } from '../lib/texts';

type State = { kind: 'loading' } | { kind: 'ok'; text: TextFile } | { kind: 'error'; message: string };

// Plain preview of an extracted text (milestone 3). Tappable words, colours and questions
// arrive with the real reader in milestone 5.
export function TextPreview({ token }: { token: string }) {
  const { date = '', id = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadText(token, date, id)
      .then((text) => !cancelled && setState({ kind: 'ok', text }))
      .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [token, date, id]);

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
      {state.kind === 'ok' && (
        <article lang="de">
          <h1 className="mb-1 font-read text-[22px] leading-tight font-semibold">{state.text.title}</h1>
          <p className="mb-3 text-[12.5px] text-muted tabular-nums" lang="tr">
            {state.text.wordCount} kelime · ~{readingMinutes(state.text.wordCount)} dk ·{' '}
            <a className="text-accent underline" href={state.text.url} target="_blank" rel="noreferrer">
              Original öffnen
            </a>
          </p>
          <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-4 py-[18px] font-read text-[19px] leading-[1.75]">
            {state.text.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted" lang="tr">
            Önizleme: kelimelere dokunma, renkler ve sorular 5. aşamada gelecek.
          </p>
        </article>
      )}
    </>
  );
}
