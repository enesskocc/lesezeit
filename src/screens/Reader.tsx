import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TOPICS, type TextFile } from '../../shared/texts';
import { Questions } from '../components/reader/Questions';
import { ReaderText } from '../components/reader/ReaderText';
import { SentenceSheet } from '../components/reader/SentenceSheet';
import { groupOf, WordSheet } from '../components/reader/WordSheet';
import { db, DEFAULT_PREFS, getPrefs, setPrefs, type WordState } from '../lib/db';
import { readerLook } from '../lib/look';
import { openText } from '../lib/offline';
import { canSpeak, speakSentences, stopSpeaking } from '../lib/speech';
import { readingMinutes } from '../lib/texts';
import { coverage, markRestKnown, undoMarkKnown, useWordStates } from '../lib/words';

type Load = { kind: 'loading' } | { kind: 'ok'; text: TextFile } | { kind: 'error'; message: string };
const RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.2];
const EMPTY_STATES: Map<string, WordState> = new Map();

export function Reader({ token }: { token: string }) {
  const { date = '', id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const states = useWordStates();
  const prefs = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  const { readerSize, readerLeading, readerFont } = prefs;
  // A stable object, so the memoized ReaderText does not re-render on every prefs change.
  const look = useMemo(() => readerLook({ readerSize, readerLeading, readerFont }), [readerSize, readerLeading, readerFont]);
  const startedAt = useRef(new Date().toISOString());
  const [word, setWord] = useState<{ s: number; i: number } | null>(null);
  const [sentence, setSentence] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<number | undefined>();
  const stop = useRef<(() => void) | null>(null);
  const [proof, setProof] = useState<number | undefined>();
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = new Date().toISOString();
    openText(token, date, id)
      .then(({ text }) => {
        if (cancelled) return;
        setLoad({ kind: 'ok', text });
        void setPrefs({ lastText: { date, id } });
      })
      .catch((e: unknown) => !cancelled && setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
      stopSpeaking();
    };
  }, [token, date, id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2400); // time to tap "Geri al"
    return () => clearTimeout(t);
  }, [toast]);

  // Stable callbacks and highlight: the memoized text must not re-render on every Reader render.
  const onWord = useCallback((s: number, i: number) => setWord({ s, i }), []);
  const onSentence = useCallback((s: number) => setSentence(s), []);
  const closeWord = useCallback(() => setWord(null), []);
  const closeSentence = useCallback(() => setSentence(null), []);
  const loadedText = load.kind === 'ok' ? load.text : null;
  const highlight = useMemo(
    () => (loadedText && word ? { s: word.s, tokens: groupOf(loadedText, word.s, word.i) } : undefined),
    [loadedText, word],
  );
  const scrollTo = (s: number) =>
    document.querySelector(`[data-sent="${s}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (load.kind === 'loading') return <p className="text-muted">Yükleniyor…</p>;
  if (load.kind === 'error') {
    return (
      <>
        <Link to="/" className="text-sm text-muted">
          ← Bugün
        </Link>
        <p className="mt-3 text-bad" role="alert">
          {load.message}
        </p>
      </>
    );
  }

  const text = load.text;
  const cov = states ? coverage(text, states) : null;
  const level = text.level ?? text.levelHeuristic;

  const toggleAudio = () => {
    if (speaking !== undefined) {
      stop.current?.();
      return;
    }
    setSpeaking(0);
    stop.current = speakSentences(
      text.sentences.map((s) => s.t),
      0,
      prefs.ttsRate,
      (i) => {
        setSpeaking(i);
        scrollTo(i);
      },
      () => setSpeaking(undefined),
    );
  };

  const finish = async () => {
    if (saving) return; // a double tap must not log the reading twice
    setSaving(true);
    try {
      const now = new Date();
      const newCards = await db.cards.where('createdAt').aboveOrEqual(startedAt.current).count();
      await db.readingLog.add({
        textId: text.id, date: text.date, startedAt: startedAt.current, finishedAt: now.toISOString(),
        seconds: Math.round((now.getTime() - new Date(startedAt.current).getTime()) / 1000),
        newCards, correct: score.correct, answered: score.answered, words: text.wordCount,
      });
      setFinished(true);
    } catch {
      setToast({ text: 'Kaydedilemedi, tekrar dene.' });
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2.5">
        <Link to="/" className="py-1 pr-1.5 text-xl text-muted" aria-label="Geri">
          ←
        </Link>
        <span className="label">
          {level} · <span lang="de">{text.sourceName}</span>
          {text.topic && ` · ${TOPICS[text.topic]}`}
        </span>
      </div>

      <h1 className="mt-1.5 mb-1 font-read text-[22px] leading-tight font-semibold" lang="de">
        {text.title}
      </h1>
      <p className="text-[12.5px] text-muted tabular-nums">
        {text.wordCount} kelime · ~{readingMinutes(text.wordCount)} dk
        {cov !== null && (
          <>
            {' '}
            · <span className="font-semibold text-good">%{cov} biliniyor</span>
          </>
        )}{' '}
        ·{' '}
        <a className="text-accent underline" href={text.url} target="_blank" rel="noreferrer">
          Original öffnen
        </a>
      </p>

      {text.levelAi && text.levelAi.confidence > 0 && (
        <details className="mt-2 text-sm" data-testid="level-reasons">
          <summary className="cursor-pointer text-muted">Neden {level}?</summary>
          <p className="mt-1">{text.levelAi.reasons_tr}</p>
        </details>
      )}

      <div className="mt-2.5 mb-1 flex flex-wrap gap-3 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block size-3 border-b-2 border-dotted border-muted align-[-2px]" />
          yeni
        </span>
        <span>
          <span className="mr-1 inline-block size-3 rounded-[3px] bg-learn align-[-2px]" />
          öğreniliyor
        </span>
        <span>düz: biliniyor</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canSpeak() && (
          <>
            <button className="btn" onClick={toggleAudio} aria-pressed={speaking !== undefined}>
              {speaking !== undefined ? '■ Durdur' : '▶ Sesli oku'}
            </button>
            <label className="flex items-center gap-1 text-sm text-muted">
              Hız
              <select
                className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-ink"
                value={prefs.ttsRate}
                onChange={(e) => void setPrefs({ ttsRate: Number(e.target.value) })}
                aria-label="Okuma hızı"
              >
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r.toLocaleString('tr-TR')}×
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button className="btn" aria-pressed={prefs.guessMode} onClick={() => void setPrefs({ guessMode: !prefs.guessMode })}>
          Tahmin modu: {prefs.guessMode ? 'açık' : 'kapalı'}
        </button>
        <button className="btn" aria-pressed={prefs.articleColors} onClick={() => void setPrefs({ articleColors: !prefs.articleColors })}>
          Artikel renkleri: {prefs.articleColors ? 'açık' : 'kapalı'}
        </button>
      </div>

      <ReaderText
        text={text}
        states={states ?? EMPTY_STATES}
        articleColors={prefs.articleColors}
        look={look}
        highlight={highlight}
        speaking={speaking}
        proof={proof}
        onWord={onWord}
        onSentence={onSentence}
      />

      {text.annotated && (
        <div className="mt-2.5">
          <button
            className="btn"
            onClick={async () => {
              const keys = await markRestKnown(text, states ?? EMPTY_STATES);
              setToast({
                text: `${keys.length} kelime biliniyor olarak işaretlendi`,
                undo: keys.length
                  ? async () => {
                      await undoMarkKnown(keys);
                      setToast({ text: 'Geri alındı' });
                    }
                  : undefined,
              });
            }}
          >
            Kalan yenileri „biliyorum“ say
          </button>
        </div>
      )}

      {text.questions && text.questions.length > 0 && (
        <Questions
          questions={text.questions}
          onProof={(s) => {
            setProof(s);
            scrollTo(s);
          }}
          onAnswered={(correct, answered) => setScore({ correct, answered })}
        />
      )}

      <div className="mt-6">
        {finished ? (
          <p className="card text-sm" role="status">
            Okuma kaydedildi{score.answered ? ` · ${score.correct}/${score.answered} doğru` : ''}. İyi iş!
          </p>
        ) : (
          <button className="btn-primary w-full" disabled={saving} onClick={() => void finish()}>
            Okumayı bitir
          </button>
        )}
      </div>

      {word && states && (
        <WordSheet key={`${word.s}:${word.i}`} text={text} s={word.s} i={word.i} states={states} guessMode={prefs.guessMode} onClose={closeWord} />
      )}
      {sentence !== null && <SentenceSheet text={text} s={sentence} rate={prefs.ttsRate} onClose={closeSentence} />}
      {toast && (
        <div
          role="status"
          className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-[10px] bg-ink px-3.5 py-2 text-[13.5px] text-bg"
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button className="font-semibold underline" onClick={() => void toast.undo!()}>
              Geri al
            </button>
          )}
        </div>
      )}
    </>
  );
}
