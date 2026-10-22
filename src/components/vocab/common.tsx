// Shared pieces of the vocabulary exercises.
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { DEFAULT_PREFS, getPrefs } from '../../lib/db';
import { canSpeak, speakGerman } from '../../lib/speech';
import type { Grade4 } from '../../lib/srs';

export interface Answer {
  cardId: string;
  rating: Grade4;
  correct: boolean;
  ms: number;
}
export type OnDone = (answers: Answer[]) => void;

/** Spec "Audio in exercises": German items only, never Turkish, and only with the sound toggle on. */
export function useSound(): { on: boolean; say: (de: string) => void } {
  const { sound } = useLiveQuery(getPrefs, [], DEFAULT_PREFS);
  const on = sound && canSpeak();
  const say = useCallback(
    (de: string) => {
      if (on) speakGerman(de);
    },
    [on],
  );
  return { on, say };
}

export const useSay = () => useSound().say;

/** Milliseconds since the exercise appeared (answer speed → Hard / Easy). */
export function useElapsed(): () => number {
  const start = useRef(Date.now());
  return useCallback(() => Date.now() - start.current, []);
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
