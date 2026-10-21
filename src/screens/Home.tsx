import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEVELS, type IndexEntry, type Level } from '../../shared/texts';
import { loadIndex, readingMinutes } from '../lib/texts';

type State = { kind: 'loading' } | { kind: 'ok'; texts: IndexEntry[] } | { kind: 'error'; message: string };

const todayLabel = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
const dayLabel = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

function TextCard({ t }: { t: IndexEntry }) {
  const level = t.level ?? t.levelHeuristic;
  return (
    <Link
      to={`/metin/${t.date}/${t.id}`}
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-surface p-3.5 text-left"
    >
      <span
        className="row-span-2 self-start rounded-md bg-accent-soft px-[7px] py-1 text-[13px] font-bold text-accent"
        title={t.level ? undefined : 'Tahmini seviye (yapay zekâ seviyesi 4. aşamada)'}
      >
        {level}
      </span>
      <h3 className="font-read text-[17px] leading-snug font-semibold" lang="de">
        {t.title}
      </h3>
      <span className="flex flex-wrap gap-x-2.5 text-[12.5px] text-muted tabular-nums">
        <span lang="de">{t.sourceName}</span>
        <span>{t.wordCount} kelime</span>
        <span>~{readingMinutes(t.wordCount)} dk</span>
      </span>
    </Link>
  );
}

export function Home({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [level, setLevel] = useState<Level | 'all'>('all');

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', texts: (await loadIndex(token)).texts });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Newest run date first; texts of the same day grouped together.
  const days = useMemo(() => {
    if (state.kind !== 'ok') return [];
    const byDay = new Map<string, IndexEntry[]>();
    for (const t of state.texts) {
      if (level !== 'all' && (t.level ?? t.levelHeuristic) !== level) continue;
      byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    }
    return [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [state, level]);

  return (
    <>
      <header className="mb-3.5 flex items-baseline justify-between gap-3">
        <h1 className="font-read text-[26px] font-semibold">Bugün</h1>
        <span className="text-[13px] text-muted" lang="de">
          {todayLabel.format(new Date())}
        </span>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Seviye">
        {(['all', ...LEVELS] as const).map((l) => (
          <button
            key={l}
            aria-pressed={level === l}
            onClick={() => setLevel(l)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg"
          >
            {l === 'all' ? 'Tümü' : l}
          </button>
        ))}
      </div>

      <div className="mt-3.5 flex flex-col gap-2.5" aria-live="polite">
        {state.kind === 'loading' && <p className="text-muted">Yükleniyor…</p>}
        {state.kind === 'error' && (
          <div className="card">
            <p className="text-bad" role="alert">
              {state.message}
            </p>
            <button className="btn mt-3" onClick={() => void load()}>
              Tekrar dene
            </button>
          </div>
        )}
        {state.kind === 'ok' && days.length === 0 && (
          <p className="text-muted">
            {state.texts.length === 0
              ? 'Henüz metin yok. Metinler her sabah yaklaşık 05:30’da hazırlanır.'
              : 'Bu seviyede metin yok.'}
          </p>
        )}
        {days.map(([day, texts], i) => (
          <section key={day} className="flex flex-col gap-2.5">
            {i > 0 && <h2 className="label mt-3">{dayLabel.format(new Date(`${day}T12:00:00`))}</h2>}
            {texts.map((t) => (
              <TextCard key={t.id} t={t} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
