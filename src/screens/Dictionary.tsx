import { useEffect, useState } from 'react';
import { WordCard } from '../components/WordCard';
import { lookup, type LookupHit } from '../lib/dict';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; query: string; hits: LookupHit[] }
  | { kind: 'error'; message: string };

const EXAMPLES = ['fing', 'Häusern', 'angefangen'];

export function Dictionary() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Debounced lookup; a newer query cancels the older one's result.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    const t = setTimeout(() => {
      lookup(q)
        .then((hits) => !cancelled && setState({ kind: 'done', query: q, hits }))
        .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <>
      <h1 className="mb-3 font-read text-[26px] font-semibold">Sözlük</h1>
      <input
        className="field"
        type="search"
        lang="de"
        placeholder="Almanca kelime veya çekimli hali…"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Almanca kelime ara"
      />
      <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Örnekler">
        {EXAMPLES.map((w) => (
          <button key={w} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium" onClick={() => setQuery(w)} lang="de">
            {w}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3" aria-live="polite">
        {state.kind === 'loading' && <p className="text-muted">Aranıyor…</p>}
        {state.kind === 'error' && (
          <p className="text-bad" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === 'done' && state.hits.length === 0 && (
          <p className="text-muted">„{state.query}“ sözlükte bulunamadı.</p>
        )}
        {state.kind === 'done' &&
          state.hits.map((h) => <WordCard key={`${h.entry.w}:${h.entry.p}`} entry={h.entry} form={state.query} />)}
      </div>
    </>
  );
}
