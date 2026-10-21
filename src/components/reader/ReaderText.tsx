import { memo, useMemo } from 'react';
import { ARTICLE } from '../../../shared/dict';
import type { TextFile, Token } from '../../../shared/texts';
import type { WordState } from '../../lib/db';
import { displayState, mweStatesOf } from '../../lib/words';

export interface Highlight {
  s: number;
  tokens: number[];
}

interface Props {
  text: TextFile;
  states: Map<string, WordState>;
  articleColors: boolean;
  highlight?: Highlight; // tokens of the open word sheet (word + separable partner / expression)
  speaking?: number; // sentence being read aloud
  proof?: number; // sentence that proves a question's answer
  onWord: (s: number, i: number) => void;
  onSentence: (s: number) => void;
}

function TokenView({ t, s, cls, onWord }: { t: Token; s: number; cls: string | null; onWord: (s: number, i: number) => void }) {
  const space = t.ws ? ' ' : '';
  if (cls === null) return <>{space + t.s}</>;
  const art = t.pos === 'NOUN' && t.g ? ARTICLE[t.g] : undefined;
  return (
    <>
      {space}
      <span
        className={`w ${cls}`}
        role="button"
        tabIndex={0}
        data-s={s}
        data-i={t.i}
        data-art={art}
        onClick={() => onWord(s, t.i)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWord(s, t.i);
          }
        }}
      >
        {t.s}
      </span>
    </>
  );
}

interface SentenceProps {
  text: TextFile;
  s: number;
  states: Map<string, WordState>;
  mweStates: Map<string, WordState>;
  hl?: number[]; // only set for the sentence with the open word sheet
  speaking: boolean;
  proof: boolean;
  onWord: (s: number, i: number) => void;
  onSentence: (s: number) => void;
}

/** One sentence; memoized so read-aloud and sheets re-render only the sentences that change. */
const SentenceView = memo(function SentenceView({ text, s, states, mweStates, hl, speaking, proof, onWord, onSentence }: SentenceProps) {
  const sent = text.sentences[s]!;
  const cls = ['sent', speaking ? 'speaking' : '', proof ? 'proof' : ''].join(' ');
  return (
    <span className={cls} data-sent={s}>
      {s > 0 && text.sentences[s - 1]!.p === sent.p ? ' ' : ''}
      {sent.tok
        ? sent.tok.map((t) => {
            const st = displayState(t, states, mweStates);
            return <TokenView key={t.i} t={t} s={s} cls={st === null ? null : st + (hl?.includes(t.i) ? ' hl' : '')} onWord={onWord} />;
          })
        : sent.t}
      {sent.tr && (
        <button className="sbtn" onClick={() => onSentence(s)} aria-label={`Cümle ${s + 1}: çeviri ve yapı`}>
          TR
        </button>
      )}
    </span>
  );
});

/** The German text: every word tappable, coloured by how well the learner knows its lemma. */
export const ReaderText = memo(function ReaderText(p: Props) {
  const { text, states } = p;
  const mweStates = useMemo(() => mweStatesOf(text, states), [text, states]);
  return (
    <div
      id="reader-text"
      lang="de"
      className={`mt-2.5 flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-4 py-[18px] font-read text-[19px] leading-[1.75] ${p.articleColors ? 'artcol' : ''}`}
    >
      {text.paragraphs.map((_, para) => (
        <p key={para}>
          {text.sentences.map((sent, s) =>
            sent.p !== para ? null : (
              <SentenceView
                key={s}
                text={text}
                s={s}
                states={states}
                mweStates={mweStates}
                hl={p.highlight?.s === s ? p.highlight.tokens : undefined}
                speaking={p.speaking === s}
                proof={p.proof === s}
                onWord={p.onWord}
                onSentence={p.onSentence}
              />
            ),
          )}
        </p>
      ))}
    </div>
  );
});
