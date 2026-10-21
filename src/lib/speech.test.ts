// Read-aloud session logic with a stub speech engine (Playwright's WebKit has no speechSynthesis).
//   npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';

type U = { text: string; onstart?: () => void; onend?: () => void; onerror?: () => void };
const queue: U[] = [];
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.SpeechSynthesisUtterance = class {
  text: string;
  constructor(text: string) {
    this.text = text;
  }
};
g.speechSynthesis = {
  getVoices: () => [],
  speak: (u: U) => queue.push(u),
  // Like browsers: cancelling fires an error ("canceled"/"interrupted") on every queued utterance.
  cancel: () => queue.splice(0).forEach((u) => u.onerror?.()),
};

const { speakGerman, speakSentences, stopSpeaking } = await import('./speech.ts');

/** Plays the queue to the end like a real engine. */
function playAll() {
  while (queue.length) {
    const u = queue.shift()!;
    u.onstart?.();
    u.onend?.();
  }
}

test('a session highlights each sentence and finishes once after the last one', () => {
  const seen: number[] = [];
  let done = 0;
  speakSentences(['A.', 'B.', 'C.'], 0, 1, (i) => seen.push(i), () => done++);
  playAll();
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(done, 1);
});

test('a word\'s "Dinle" during read-aloud ends the session (no stuck "Durdur")', () => {
  let done = 0;
  speakSentences(['A.', 'B.'], 0, 1, () => {}, () => done++);
  speakGerman('das Haus');
  assert.equal(done, 1);
  assert.equal(queue.length, 1, 'only the word is queued now');
  assert.equal(queue[0]!.text, 'das Haus');
  queue.splice(0);
});

test('stop button, engine errors and stopSpeaking all end a session exactly once', () => {
  let a = 0;
  const stop = speakSentences(['A.', 'B.'], 0, 1, () => {}, () => a++);
  stop();
  stop();
  assert.equal(a, 1);

  let b = 0;
  speakSentences(['A.', 'B.'], 0, 1, () => {}, () => b++);
  queue.splice(0).forEach((u) => u.onerror?.()); // e.g. iOS cancels when the app goes to background
  assert.equal(b, 1);

  let c = 0;
  speakSentences(['A.'], 0, 1, () => {}, () => c++);
  stopSpeaking();
  assert.equal(c, 1);
});
