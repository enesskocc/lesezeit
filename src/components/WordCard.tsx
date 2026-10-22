import { ARTICLE, POS_CODES, type LemmaEntry } from '../../shared/dict';
import { canSpeak, speakGerman } from '../lib/speech';

const ARTICLE_COLOR = { der: 'text-der', die: 'text-die', das: 'text-das' } as const;

/** Grammar rows that apply to this part of speech, in reading order. */
function grammarRows(e: LemmaEntry): [string, string][] {
  const rows: [string, string | undefined][] = [];
  if (e.p === 'n') {
    rows.push(['Çoğul', e.pl ? `die ${e.pl}` : e.g ? '— (çoğulu yok)' : undefined]);
    rows.push(['Genitiv', e.gen && e.g ? `${e.g === 'f' ? 'der' : 'des'} ${e.gen}` : e.gen]);
  }
  if (e.p === 'v') {
    rows.push(['Präteritum', e.prt]);
    rows.push(['Partizip II', e.pp]);
    rows.push(['Yardımcı fiil', e.aux]);
    // "fing an" → "an- (fing … an)": shows how the prefix moves to the end of the clause.
    rows.push(['Ayrılan ön ek', e.sep && `${e.sep}- (${e.prt ? e.prt.replace(/ (\S+)$/, ' … $1') : e.w})`]);
    rows.push(['Dönüşlü', e.refl ? `sich ${e.w} (kullanımı var)` : undefined]);
    rows.push(['Rektion', e.rek?.join(' · ')]);
  }
  if (e.p === 'a' || e.p === 'd') {
    rows.push(['Karşılaştırma', [e.cmp, e.sup].filter(Boolean).join(' · ') || undefined]);
  }
  return rows.filter((r): r is [string, string] => !!r[1]);
}

export function WordCard({ entry: e, form }: { entry: LemmaEntry; form?: string }) {
  const article = e.p === 'n' && e.g ? ARTICLE[e.g] : undefined;
  const spoken = article ? `${article} ${e.w}` : e.w;
  const rows = grammarRows(e);

  return (
    <article className="card" lang="tr">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-read text-[26px] font-semibold leading-tight" lang="de">
            {article && <span className={`${ARTICLE_COLOR[article]} font-bold`}>{article} </span>}
            {e.w}
          </h2>
          <div className="label mt-0.5">
            <span lang="de">{POS_CODES[e.p]}</span>
            {form && form.toLocaleLowerCase('de-DE') !== e.w.toLocaleLowerCase('de-DE') && (
              <span className="normal-case tracking-normal">
                {' '}
                · metinde: „<span lang="de">{form}</span>“
              </span>
            )}
          </div>
        </div>
        {canSpeak() && (
          <button className="btn shrink-0" onClick={() => speakGerman(spoken)} aria-label={`${spoken} telaffuzunu dinle`}>
            🔊 Dinle
          </button>
        )}
      </div>

      {e.tr && (
        <div className="mt-3 rounded-[10px] bg-accent-soft px-3 py-2.5">
          <div className="label">Türkçe{e.trAi && ' · yapay zekâ'}</div>
          <div className="text-[17px] font-semibold">{e.tr.join(', ')}</div>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd lang="de">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {e.en && (
        <p className="mt-3 text-sm">
          <span className="text-muted">İngilizce: </span>
          <span lang="en">{e.en.join('; ')}</span>
        </p>
      )}
      {e.de && (
        <p className="mt-1.5 text-sm" lang="de">
          <span className="text-muted" lang="tr">Almanca tanım: </span>
          {e.de}
        </p>
      )}
      {(e.syn || e.ant || e.fam) && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-sm">
          {e.syn && (
            <>
              <dt className="text-muted">Eş anlamlı</dt>
              <dd lang="de">{e.syn.join(', ')}</dd>
            </>
          )}
          {e.ant && (
            <>
              <dt className="text-muted">Zıt anlamlı</dt>
              <dd lang="de">{e.ant.join(', ')}</dd>
            </>
          )}
          {e.fam && (
            <>
              <dt className="text-muted">Kelime ailesi</dt>
              <dd lang="de">{e.fam.join(', ')}</dd>
            </>
          )}
        </dl>
      )}
      {e.rank && <p className="mt-3 text-xs text-muted tabular-nums">Sıklık sırası: {e.rank.toLocaleString('de-DE')}</p>}
    </article>
  );
}
