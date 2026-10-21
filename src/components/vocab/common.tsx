// Shared pieces of the vocabulary exercises.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PREFS, getPrefs, type CardRow } from '../../lib/db';
import { articleOf, pluralOf } from '../../lib/exercises';
import { speakGerman } from '../../lib/speech';
import type { Grade4 } from '../../lib/srs';

export interface Answer {
  cardId: string;
  rating: Grade4;
  correct: boolean;
  ms: number;
  at?: number; // review time to save (default: now)
}
export type OnDone = (answers: Answer[]) => void;

/** Spec "Audio in exercises": German items only, never Turkish, and only with the sound toggle on. */
export function useSay(): (de: string) => void {
  const { sound } = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  return useCallback(
    (de: string) => {
      if (sound) speakGerman(de);
    },
    [sound],
  );
}

/** Milliseconds since the exercise appeared (answer speed → Hard / Easy). */
export function useElapsed(): () => number {
  const start = useRef(Date.now());
  return useCallback(() => Date.now() - start.current, []);
}

/** "das Haus · die Häuser", "fing an · hat angefangen" — the grammar shown with an answer. */
export function grammarLine(card: CardRow): string | undefined {
  const art = articleOf(card);
  if (art) {
    const pl = pluralOf(card);
    return `${art} ${card.lemma}${pl ? ` · die ${pl}` : ''}`;
  }
  const e = card.entry;
  if (e?.p === 'v' && e.prt && e.pp) return `${e.prt} · ${e.aux === 'sein' ? 'ist' : 'hat'} ${e.pp}`;
  return undefined;
}

export function TypeAnswer({ label, prefix, onSubmit }: { label: string; prefix?: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value);
      }}
    >
      {prefix && (
        <span className="font-read text-lg" lang="de">
          {prefix}
        </span>
      )}
      <input
        ref={input}
        className="field font-read"
        lang="de"
        aria-label={label}
        placeholder={label}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn-primary shrink-0" disabled={!value.trim()}>
        Kontrol
      </button>
    </form>
  );
}

/** Right / wrong box with the correct answer and "Devam". */
export function Feedback({ correct, partial, children, onNext }: { correct: boolean; partial?: boolean; children?: ReactNode; onNext: () => void }) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus(), []);
  const title = !correct ? 'Yanlış' : partial ? 'Neredeyse' : 'Doğru';
  return (
    <div
      role="status"
      data-testid="feedback"
      className={`mt-3 rounded-[10px] border-2 px-3 py-2.5 ${!correct ? 'border-bad' : partial ? 'border-learn' : 'border-good'}`}
    >
      <div className={`font-semibold ${correct ? 'text-good' : 'text-bad'}`}>{title}</div>
      {children}
      <button ref={next} className="btn-primary mt-3 w-full" onClick={onNext}>
        Devam
      </button>
    </div>
  );
}

/** A German word or sentence that speaks itself when tapped. */
export function Spoken({ text, className, children }: { text: string; className?: string; children?: ReactNode }) {
  const say = useSay();
  return (
    <button type="button" className={`text-left ${className ?? ''}`} lang="de" onClick={() => say(text)}>
      {children ?? text}
    </button>
  );
}
