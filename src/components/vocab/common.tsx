// Shared pieces of the vocabulary screens.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { canSpeak, speakGerman } from '../../lib/speech';
import type { Grade4 } from '../../lib/srs';

export interface Answer {
  cardId: string;
  rating: Grade4;
  correct: boolean;
  ms: number;
}
export type OnDone = (answers: Answer[]) => void;

/**
 * German pronunciation on request (a 🔊 tap). Nothing plays by itself any more (Enes 2026-10-22),
 * so there is no sound toggle: the button is only shown where the device can speak.
 */
export function speak(de: string): void {
  if (canSpeak()) speakGerman(de);
}

/** Milliseconds since the exercise appeared. */
export function useElapsed(): () => number {
  const start = useRef(Date.now());
  return useCallback(() => Date.now() - start.current, []);
}

export function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** Round 🔊 button that reads a German word. Hidden where the device has no speech. */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  if (!canSpeak()) return null;
  return (
    <button
      type="button"
      aria-label={`${text}: dinle`}
      data-testid="speak"
      onClick={() => speak(text)}
      className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent active:scale-95 ${className ?? ''}`}
    >
      <SpeakerIcon className="size-5" />
    </button>
  );
}

/** Right / wrong box with the result and "Devam". */
export function Feedback({ correct, partial, children, onNext }: { correct: boolean; partial?: boolean; children?: ReactNode; onNext: () => void }) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus(), []);
  const title = !correct ? 'Yanlış' : partial ? 'Neredeyse' : 'Doğru';
  return (
    <div
      role="status"
      data-testid="feedback"
      className={`mt-4 rounded-xl border-2 px-3.5 py-3 ${!correct ? 'border-bad' : partial ? 'border-learn' : 'border-good'}`}
    >
      <div className={`font-semibold ${correct ? 'text-good' : 'text-bad'}`}>{title}</div>
      {children}
      <button ref={next} className="btn-primary mt-3 w-full" onClick={onNext}>
        Devam
      </button>
    </div>
  );
}

/** A German headword with its 🔊 button. */
export function Spoken({ text, className }: { text: string; className?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={className} lang="de">
        {text}
      </span>
      <SpeakButton text={text} />
    </div>
  );
}
