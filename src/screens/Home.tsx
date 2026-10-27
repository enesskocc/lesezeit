import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEVELS, TOPICS, type IndexEntry, type Level, type TextFile, type Topic } from '../../shared/texts';
import type { WordState } from '../lib/db';
import { db } from '../lib/db';
import { cachedEntries, syncTextCache } from '../lib/offline';
import { loadIndex, readingMinutes } from '../lib/texts';
import { coverage, useWordStates } from '../lib/words';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; texts: IndexEntry[]; stale?: string } // stale: list comes from the offline cache
  | { kind: 'error'; message: string };

const todayLabel = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
const dayLabel = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
// en-CA formats as YYYY-MM-DD.
const berlinDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });


function TextCard({ t, cached, states }: { t: IndexEntry; cached?: TextFile; states?: Map<string, WordState> }) {
  const level = t.level ?? t.levelHeuristic;
  const cov = cached && states ? coverage(cached, states) : null;
  return (
    <Link
      to={`/oku/${t.date}/${t.id}`}
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-surface p-3.5 text-left"
    >
      <span className="row-span-2 self-start rounded-md bg-accent-soft px-[7px] py-1 text-[13px] font-bold text-accent">{level}</span>
      <h3 className="font-read text-[17px] leading-snug font-semibold" lang="de">
        {t.title}
      </h3>
      <span className="flex flex-wrap gap-x-2.5 text-[12.5px] text-muted tabular-nums">
        <span lang="de">{t.sourceName}</span>
        {t.topic && <span>{TOPICS[t.topic]}</span>}
        <span>{t.wordCount} kelime</span>
        <span>~{readingMinutes(t.wordCount)} dk</span>
        {cov !== null && <span className="font-semibold text-good">%{cov} biliniyor</span>}
        {cached && <span title="Çevrimdışı okunabilir">⤓</span>}
      </span>
    </Link>
  );
}

export function Home({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [topic, setTopic] = useState<Topic | 'all'>('all');
  const states = useWordStates();
  const cache = useLiveQuery(async () => new Map((await db.textCache.toArray()).map((r) => [r.id, r.text] as const)), []);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const index = await loadIndex(token);
      setState({ kind: 'ok', texts: index.texts });
      // Download the ready texts for offline reading in the background (Enes: automatic).
      void syncTextCache(token, index.texts);
    } catch (e) {
      // GitHub unreachable (offline, timeout, expired token, 5xx): show what is downloaded.
      const message = e instanceof Error ? e.message : String(e);
      const cached = await cachedEntries();
      setState(cached.length ? { kind: 'ok', texts: cached, stale: message } : { kind: 'error', message });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const annotated = useMemo(() => (state.kind === 'ok' ? state.texts.filter((t) => t.annotated) : []), [state]);
  const topics = [...new Set(annotated.map((t) => t.topic).filter((t): t is Topic => !!t))];

  // Newest first, grouped by the day the text was prepared (picked from a 7-day pool).
  const days = useMemo(() => {
    const byDay = new Map<string, IndexEntry[]>();
    for (const t of annotated) {
      if (level !== 'all' && (t.level ?? t.levelHeuristic) !== level) continue;
      if (topic !== 'all' && t.topic !== topic) continue;
      const day = t.annotatedAt ? berlinDay.format(new Date(t.annotatedAt)) : t.date;
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
    }
    return [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [annotated, level, topic]);

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
          <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)} className="chip">
            {l === 'all' ? 'Tümü' : l}
          </button>
        ))}
      </div>
      {topics.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Konu">
          <button aria-pressed={topic === 'all'} onClick={() => setTopic('all')} className="chip">
            Tüm konular
          </button>
          {topics.map((t) => (
            <button key={t} aria-pressed={topic === t} onClick={() => setTopic(t)} className="chip">
              {TOPICS[t]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-col gap-2.5" aria-live="polite">
        {state.kind === 'loading' && <p className="text-muted">Yükleniyor…</p>}
        {state.kind === 'ok' && state.stale && (
          <p className="rounded-[10px] bg-accent-soft px-3 py-2 text-[13px]" role="status" title={state.stale}>
            Bağlantı kurulamadı; indirilmiş metinler gösteriliyor.{' '}
            <button className="underline" onClick={() => void load()}>
              Tekrar dene
            </button>
          </p>
        )}
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
            {annotated.length
              ? 'Bu filtrede metin yok.'
              : 'Henüz hazır metin yok. Günün metni her sabah yaklaşık 05:30’da hazırlanır.'}
          </p>
        )}
        {days.map(([day, texts], i) => (
          <section key={day} className="flex flex-col gap-2.5">
            {i > 0 && <h2 className="label mt-3">{dayLabel.format(new Date(`${day}T12:00:00`))}</h2>}
            {texts.map((t) => (
              <TextCard key={t.id} t={t} cached={cache?.get(t.id)} states={states} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
