import type { TextFile } from '../../../shared/texts';
import { canSpeak, speakGerman } from '../../lib/speech';
import { BottomSheet } from './BottomSheet';

/** Spec "Tap a sentence": Turkish translation, structure notes, pronounce ("Neden böyle?" dropped, Enes 2026-10-27). */
export function SentenceSheet({ text, s, rate, onClose }: { text: TextFile; s: number; rate: number; onClose: () => void }) {
  const sent = text.sentences[s]!;
  return (
    <BottomSheet label={`Cümle ${s + 1}`} onClose={onClose}>
      <span className="label">Cümle {s + 1} · çeviri</span>
      <p className="mt-1 mb-3 font-read text-[17px]" data-testid="sentence-translation">
        {sent.tr}
      </p>
      {sent.notes && sent.notes.length > 0 && (
        <>
          <div className="label mb-1.5">Yapı</div>
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-bg px-3 py-2.5 text-sm">
            {sent.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        </>
      )}
      {canSpeak() && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button className="btn" onClick={() => speakGerman(sent.t, rate)}>
            🔊 Cümleyi dinle
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
