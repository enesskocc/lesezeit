import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { ARTICLE, normalizeKey, POS_CODES, type LemmaEntry, type PosCode } from '../../../shared/dict';
import type { TextFile, Token } from '../../../shared/texts';
import { db, type WordState } from '../../lib/db';
import { lookup } from '../../lib/dict';
import { canSpeak, speakGerman } from '../../lib/speech';
import { addCard, displayLemma, lemmaKey, mweKey, setWordState, stateOf } from '../../lib/words';
import { BottomSheet } from './BottomSheet';

const UPOS_TO_DICT: Record<string, PosCode> = {
  NOUN: 'n', VERB: 'v', AUX: 'v', ADJ: 'a', ADV: 'd', ADP: 'p', CCONJ: 'c', SCONJ: 'c', PRON: 'r', DET: 't', NUM: 'm', PART: 'x', INTJ: 'i',
};
const UPOS_NAME: Record<string, string> = {
  NOUN: 'Nomen', VERB: 'Verb', AUX: 'Hilfsverb', ADJ: 'Adjektiv', ADV: 'Adverb', ADP: 'Präposition', DET: 'Artikel',
  PRON: 'Pronomen', PROPN: 'Eigenname', CCONJ: 'Konjunktion', SCONJ: 'Konjunktion (Nebensatz)', PART: 'Partikel', NUM: 'Zahl', INTJ: 'Interjektion',
};
const CASE_NAME = { Nom: 'Nominativ', Akk: 'Akkusativ', Dat: 'Dativ', Gen: 'Genitiv' } as const;
const ARTICLE_CLASS = { der: 'text-der', die: 'text-die', das: 'text-das' } as const;
const MWE_KIND = { nvv: 'Nomen-Verb-Verbindung', vprep: 'Verb + Präposition', idiom: 'Redewendung', other: 'Ausdruck' } as const;

/** Tokens to highlight for a tapped word: the word, its separable partner and its expression. */
export function groupOf(text: TextFile, s: number, i: number): number[] {
  const tok = text.sentences[s]?.tok?.[i];
  if (!tok) return [i];
  const out = new Set([i]);
  if (tok.sep !== undefined) out.add(tok.sep);
  const mwe = tok.mwe ? text.mwes?.find((m) => m.id === tok.mwe) : undefined;
  mwe?.tok.forEach((t) => out.add(t));
  return [...out].sort((a, b) => a - b);
}

/** Preposition that governs this word's case, looking back a few tokens ("mit der Arbeit" → mit). */
function governingPreposition(toks: Token[], i: number): string | undefined {
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const t = toks[j]!;
    if (t.k === 'p' || t.pos === 'VERB' || t.pos === 'AUX') return undefined;
    if (t.pos === 'ADP' && t.sep === undefined) return t.s;
  }
  return undefined;
}

function useEntries(tok: Token, text: TextFile): LemmaEntry[] | undefined {
  const key = tok.l ? normalizeKey(tok.l) : '';
  const embedded = text.dict?.[key];
  const [online, setOnline] = useState<LemmaEntry[] | undefined>();
  useEffect(() => {
    if (embedded || !tok.l) return;
    let cancelled = false;
    // Texts annotated before the offline dictionary existed: look the lemma up online.
    lookup(tok.l)
      .then((hits) => !cancelled && setOnline(hits.filter((h) => normalizeKey(h.entry.w) === key).map((h) => h.entry)))
      .catch(() => !cancelled && setOnline([]));
    return () => {
      cancelled = true;
    };
  }, [embedded, tok.l, key]);
  return embedded ?? online;
}

interface Props {
  text: TextFile;
  s: number;
  i: number;
  states: Map<string, WordState>;
  guessMode: boolean;
  onClose: () => void;
}

export function WordSheet({ text, s, i, states, guessMode, onClose }: Props) {
  const toks = text.sentences[s]!.tok!;
  const tok = toks[i]!;
  const state = stateOf(tok, states);
  const key = lemmaKey(tok.l!);
  const group = groupOf(text, s, i);
  const mwe = tok.mwe ? text.mwes?.find((m) => m.id === tok.mwe) : undefined;
  const entries = useEntries(tok, text);
  // The detached prefix ("an" in "fängt … an") carries the verb's lemma: show it as that verb.
  const partner = tok.sep !== undefined ? toks[tok.sep] : undefined;
  const verbPart = partner && (partner.pos === 'VERB' || partner.pos === 'AUX') ? partner : tok;
  const pos = tok.sep !== undefined ? 'v' : UPOS_TO_DICT[tok.pos ?? ''];
  const meaning = verbPart.tr ?? tok.tr;
  const entry = entries?.find((e) => e.p === pos && (!tok.g || !e.g || e.g === tok.g)) ?? entries?.[0];
  const card = useLiveQuery(() => db.cards.get(key), [key]);
  const mweCard = useLiveQuery(() => (mwe ? db.cards.get(mweKey(mwe)) : undefined), [mwe]);

  // Spec "Guess mode": new and learning words first show only the word in its sentence.
  const [revealed, setRevealed] = useState(!(guessMode && (state === 'new' || state === 'learning')));
  const [guessed, setGuessed] = useState(false);
  const [guessResult, setGuessResult] = useState<string | null>(null);

  const article = tok.pos === 'NOUN' && (tok.g ?? entry?.g) ? ARTICLE[(tok.g ?? entry?.g)!] : undefined;
  const lemma = tok.l!;
  const spoken = article ? `${article} ${lemma}` : lemma;
  const separable =
    tok.sep !== undefined ? `${toks[Math.min(i, tok.sep)]!.s} … ${toks[Math.max(i, tok.sep)]!.s}` : undefined;
  const sentenceWithGroup = toks.map((t) => (
    <span key={t.i}>
      {t.ws ? ' ' : ''}
      {group.includes(t.i) ? <b className="rounded-[3px] bg-learn px-0.5">{t.s}</b> : t.s}
    </span>
  ));

  const save = (via: 'add' | 'guess') =>
    addCard({
      key, kind: 'lemma', display: displayLemma(tok, entry), pos: verbPart.pos, meaning_tr: meaning ?? entry?.tr?.[0] ?? entry?.en?.[0] ?? '',
      text, s, tokens: group, via,
    });

  if (!revealed) {
    return (
      <BottomSheet label="Tahmin modu" onClose={onClose}>
        <div className="label">Tahmin modu</div>
        <div className="font-read text-[26px] font-semibold" lang="de">
          {separable ?? tok.s}
        </div>
        <p className="mt-2 mb-1.5 font-read text-[17px] leading-relaxed" lang="de" data-testid="guess-sentence">
          {sentenceWithGroup}
        </p>
        <p className="text-[13px] text-muted">Bağlamdan anlamını tahmin et, sonra kontrol et.</p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              setRevealed(true);
              setGuessed(true);
            }}
          >
            Anlamı göster
          </button>
          {canSpeak() && (
            <button className="btn" onClick={() => speakGerman(separable ? `${tok.s}` : spoken)}>
              🔊 Dinle
            </button>
          )}
        </div>
      </BottomSheet>
    );
  }

  const rows: [string, string | undefined][] = [];
  if (tok.pos === 'NOUN') {
    rows.push(['Çoğul', (tok.pl ?? entry?.pl) && `die ${tok.pl ?? entry?.pl}`]);
    rows.push(['Genitiv', entry?.gen && `${article === 'die' ? 'der' : 'des'} ${entry.gen}`]);
  }
  if (pos === 'v') {
    rows.push(['Formlar', [entry?.prt, entry?.pp && `${entry.aux === 'sein' ? 'ist' : 'hat'} ${entry.pp}`].filter(Boolean).join(' · ') || undefined]);
    rows.push(['Yardımcı fiil', entry?.aux]);
    rows.push(['Rektion', entry?.rek?.join(' · ')]);
    if (tok.refl) rows.push(['Dönüşlü', `sich ${lemma}`]);
  }
  if (pos === 'a' || pos === 'd') rows.push(['Karşılaştırma', [entry?.cmp, entry?.sup].filter(Boolean).join(' · ') || undefined]);
  if (tok.c) {
    const prep = governingPreposition(toks, i);
    rows.push(['Bu cümlede', `${CASE_NAME[tok.c]}${prep ? ` · „${prep}“ yüzünden` : ''}`]);
  }
  if (separable) rows.push(['Ayrılan fiil', `„${separable}“ → ${lemma}`]);
  const otherMeanings = [...(entry?.tr ?? [])].filter((m) => m !== meaning);

  return (
    <BottomSheet label={`Kelime: ${lemma}`} onClose={onClose}>
      {guessed && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[10px] bg-accent-soft px-2.5 py-2 text-sm font-semibold">
          {guessResult ? (
            <span>{guessResult}</span>
          ) : (
            <>
              <span className="min-w-[140px] flex-1">Tahminin doğru muydu?</span>
              <button className="btn" onClick={() => setGuessResult('Güzel tahmin!')}>
                Evet
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await save('guess');
                  setGuessResult('Kartlara eklendi, bu cümleyle birlikte tekrar edeceksin.');
                }}
              >
                Hayır
              </button>
            </>
          )}
        </div>
      )}

      <h2 className="font-read text-[26px] leading-tight font-semibold" lang="de" data-testid="sheet-lemma">
        {article && <span className={`${ARTICLE_CLASS[article]} font-bold`}>{article} </span>}
        {tok.refl && pos === 'v' ? `sich ${lemma}` : lemma}
      </h2>
      <div className="label mt-0.5">
        <span lang="de">{(entry && POS_CODES[entry.p]) || UPOS_NAME[tok.pos ?? ''] || tok.pos}</span>
        {normalizeKey(tok.s) !== normalizeKey(lemma) && (
          <span className="tracking-normal normal-case">
            {' '}
            · metinde: „<span lang="de">{separable ?? tok.s}</span>“
          </span>
        )}
      </div>

      {meaning && (
        <div className="my-2.5 rounded-[10px] bg-accent-soft px-3 py-2.5">
          <span className="label">Bu cümledeki anlamı</span>
          <b className="block text-[17px]" data-testid="sheet-meaning">
            {meaning}
          </b>
        </div>
      )}

      {rows.some((r) => r[1]) && (
        <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-sm">
          {rows
            .filter((r): r is [string, string] => !!r[1])
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd lang="de">{v}</dd>
              </div>
            ))}
        </dl>
      )}

      {(otherMeanings.length > 0 || entry?.en) && (
        <p className="text-sm">
          <span className="text-muted">Sözlükte: </span>
          {[...otherMeanings, ...(entry?.en ?? []).map((e) => `(EN) ${e}`)].slice(0, 5).join(' · ')}
        </p>
      )}
      {tok.flag && <p className="mt-1.5 text-xs text-muted">Bu kelime sözlükte doğrulanamadı (örneğin yeni bir birleşik isim).</p>}

      {mwe && (
        <div className="my-2.5 rounded-[10px] border border-line px-3 py-2.5">
          <span className="label">{MWE_KIND[mwe.kind]}</span>
          <div className="font-read text-base font-semibold" lang="de">
            {mwe.de}
          </div>
          <div>{mwe.tr}</div>
          <button
            className="btn mt-2"
            disabled={!!mweCard}
            onClick={() =>
              addCard({ key: mweKey(mwe), kind: 'mwe', display: mwe.de, meaning_tr: mwe.tr, text, s, tokens: mwe.tok, via: 'add' })
            }
          >
            {mweCard ? 'İfade kartlarda' : '+ İfadeyi kartlara ekle'}
          </button>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {canSpeak() && (
          <button className="btn" onClick={() => speakGerman(spoken)}>
            🔊 Dinle
          </button>
        )}
        <button className="btn-primary" disabled={!!card} onClick={() => void save('add')}>
          {card ? 'Kartlarda' : '+ Kartlara ekle'}
        </button>
        <button
          className="btn"
          onClick={async () => {
            await setWordState(key, 'known');
            onClose();
          }}
        >
          Biliyorum
        </button>
        <button
          className="btn"
          onClick={async () => {
            await setWordState(key, 'ignored');
            onClose();
          }}
        >
          Yok say
        </button>
      </div>
    </BottomSheet>
  );
}
