import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ColumnChart } from '../components/ColumnChart';
import { db } from '../lib/db';
import type { Phase } from '../lib/srs';
import { phaseCounts, retention, reviewsPerDay, streak, wordsPerWeek } from '../lib/stats';
import { PHASE_LABEL } from './Vocab';

const PHASES: Phase[] = ['new', 'learning', 'young', 'mature'];
const shortDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
/** "2026-10-27" (a learning day) → "27 Eki". */
const dayLabel = (key: string) => shortDate.format(new Date(`${key}T12:00:00`));

async function load() {
  const [cards, reviews, readings, cached] = await Promise.all([
    db.cards.toArray(),
    db.reviewLog.toArray(),
    db.readingLog.toArray(),
    db.textCache.toArray(),
  ]);
  // Readings finished before milestone 10 have no word count: take it from the downloaded text.
  const words = new Map(cached.map((c) => [c.id, c.text.wordCount]));
  return { cards, reviews, readings: readings.map((r) => ({ ...r, words: r.words ?? words.get(r.textId) })) };
}

function Tile({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="card px-1 py-2.5 text-center" data-testid={testId}>
      <div className="text-[22px] font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

/** Spec "Stats": cards by state, reviews per day, retention, streak, words read per week. */
export function Stats() {
  const data = useLiveQuery(load, []);
  if (!data) return <p className="text-muted">Yükleniyor…</p>;

  const now = new Date();
  const phases = phaseCounts(data.cards);
  const perDay = reviewsPerDay(data.reviews, now);
  const kept = retention(data.reviews, now);
  const days = streak(data.reviews, data.readings, now);
  const weeks = wordsPerWeek(data.readings, now);
  const total30 = perDay.reduce((s, d) => s + d.n, 0);

  return (
    <>
      <Link to="/kelimeler" className="text-sm text-muted">
        ← Kelimelere dön
      </Link>
      <h1 className="mt-1 mb-3 font-read text-[26px] font-semibold">İstatistikler</h1>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Seri" value={`${days} gün`} testId="stat-streak" />
        <Tile
          label="Hatırlama"
          value={kept ? `%${Math.round(kept.rate * 100)}` : '–'}
          hint={kept ? `${kept.n} tekrar · 30 gün` : 'henüz tekrar yok'}
          testId="stat-retention"
        />
        <Tile label="Bugün" value={String(perDay.at(-1)!.n)} hint="tekrar" testId="stat-today" />
      </div>

      <div className="label mt-4 mb-2">Kartlar</div>
      <div className="grid grid-cols-4 gap-2" data-testid="stat-phases">
        {PHASES.map((p) => (
          <Tile key={p} label={PHASE_LABEL[p]} value={String(phases[p])} />
        ))}
      </div>

      <ColumnChart
        title="Günlük tekrar · 30 gün"
        summary={`toplam ${total30.toLocaleString('tr-TR')}`}
        unit="tekrar"
        testId="chart-reviews"
        columns={perDay.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.n }))}
      />
      <ColumnChart
        title="Okunan kelime · haftalık"
        unit="kelime"
        testId="chart-words"
        columns={weeks.map((w) => ({ key: w.week, label: `${dayLabel(w.week)} haftası`, value: w.words }))}
      />
      <p className="mt-3 text-xs text-muted">
        Gün sabah 04:00’te başlar. Serbest eşleştirme tekrar sayılmaz ama seriyi sürdürür; hatırlama oranı yalnızca öğrenme
        adımlarını geçmiş kartların tekrarlarından hesaplanır.
      </p>
    </>
  );
}
