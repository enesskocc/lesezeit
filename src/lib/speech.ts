// German text-to-speech with the browser's on-device voices (free, works offline on iOS).
// Must be started from a tap handler: iOS only allows speech started by a user gesture.

function germanVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'de-DE' && v.localService) ?? voices.find((v) => v.lang.startsWith('de'));
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function utterance(text: string, rate: number): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = rate;
  const voice = germanVoice();
  if (voice) u.voice = voice;
  return u;
}

/**
 * The running read-aloud session, if any. Anything else that speaks (a word's "Dinle") cancels
 * the shared queue, so it must end the session first — otherwise the reader would wait forever
 * for an `onend` that never comes and stay on "Durdur".
 */
let session: { finish: () => void } | null = null;

export function stopSpeaking(): void {
  session?.finish();
  if (canSpeak()) window.speechSynthesis.cancel();
}

export function speakGerman(text: string, rate = 0.95): void {
  if (!canSpeak()) return;
  stopSpeaking();
  window.speechSynthesis.speak(utterance(text, rate));
}

/**
 * Reads sentences one after another (spec: "sentence-by-sentence with the current sentence
 * highlighted"). All utterances are queued at once — more reliable on iOS than starting the next
 * one from an `onend` callback. Every utterance counts down on end OR error, so the session
 * always finishes. Returns a stop function.
 */
export function speakSentences(
  sentences: string[],
  from: number,
  rate: number,
  onSentence: (index: number) => void,
  onDone: () => void,
): () => void {
  if (!canSpeak()) return () => {};
  stopSpeaking();
  let open = true;
  const finish = () => {
    if (!open) return;
    open = false;
    if (session === me) session = null;
    onDone();
  };
  const me = { finish };
  session = me;
  const queue = sentences.slice(from);
  let remaining = queue.length;
  const settled = () => {
    remaining--;
    if (remaining <= 0) finish();
  };
  queue.forEach((s, k) => {
    const u = utterance(s, rate);
    u.onstart = () => open && onSentence(from + k);
    u.onend = settled;
    u.onerror = settled; // includes "interrupted"/"canceled" (iOS also cancels when the app is backgrounded)
    window.speechSynthesis.speak(u);
  });
  if (remaining === 0) finish();
  return () => {
    finish();
    window.speechSynthesis.cancel();
  };
}
