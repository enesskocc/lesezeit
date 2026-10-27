import { useState } from 'react';

export interface Column {
  key: string;
  label: string; // "27 Eki", "26 Eki haftası"
  value: number;
}

/**
 * One series of columns (dataviz rules: single hue, no legend — the title names it; ≤ 24 px wide,
 * 4 px rounded top, square at the baseline, 2 px gaps; only the maximum is labelled). Tapping a
 * column shows its value (the phone has no hover); the table below carries every value.
 */
export function ColumnChart(p: { title: string; unit: string; columns: Column[]; testId: string; summary?: string }) {
  const { title, unit, columns, testId } = p;
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...columns.map((c) => c.value));
  const shown = picked === null ? null : columns[picked]!;
  const n = (v: number) => v.toLocaleString('tr-TR');
  return (
    <section className="card mt-3" aria-label={title} data-testid={testId}>
      <div className="label">{title}</div>
      {/* One line that never wraps, so tapping a column does not move the chart. */}
      <div className="truncate text-xs text-muted tabular-nums" aria-live="polite" data-testid={`${testId}-value`}>
        {shown ? `${shown.label}: ${n(shown.value)} ${unit}` : [p.summary, `en çok ${n(max)}`].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-2 flex h-28 items-end gap-[2px] border-b border-line">
        {columns.map((c, i) => (
          <button
            key={c.key}
            className="flex h-full flex-1 items-end justify-center"
            aria-label={`${c.label}: ${c.value} ${unit}`}
            aria-pressed={picked === i}
            onClick={() => setPicked(picked === i ? null : i)}
          >
            <span
              className={`block w-full max-w-6 rounded-t-[4px] ${picked === null || picked === i ? 'bg-accent' : 'bg-accent/40'}`}
              style={{ height: c.value ? `${Math.max(3, (c.value / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{columns[0]?.label}</span>
        <span>{columns.at(-1)?.label}</span>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">Tablo</summary>
        <table className="mt-1 w-full tabular-nums">
          <tbody>
            {[...columns].reverse().map((c) => (
              <tr key={c.key} className="border-t border-line">
                <td className="py-1">{c.label}</td>
                <td className="py-1 text-right">{c.value.toLocaleString('tr-TR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
