// Reading and writing the private data repo (spec, content pipeline step 3 + output).
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import {
  PipelineConfigSchema,
  SeenSchema,
  SourcesFileSchema,
  TextIndexSchema,
  type IndexEntry,
  type PipelineConfig,
  type Seen,
  type Source,
  type TextFile,
  type TextIndex,
} from '../shared/texts.ts';

const SEEN_REJECTED_DAYS = 30; // seen.json forgets URLs after this; feeds have long dropped them by then

export class DataRepo {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  private read<S extends z.ZodType>(rel: string, schema: S, fallback: z.input<S>): z.output<S> {
    const p = this.file(rel);
    const raw = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
    return schema.parse(raw);
  }

  // Write to a temp file, then rename: a crash never leaves a half-written JSON file behind.
  private write(rel: string, data: unknown) {
    const p = this.file(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(`${p}.tmp`, `${JSON.stringify(data, null, 1)}\n`);
    fs.renameSync(`${p}.tmp`, p);
  }

  sources(): Source[] {
    return this.read('sources.json', SourcesFileSchema, { sources: [] }).sources.filter((s) => s.enabled);
  }

  config(): PipelineConfig {
    return this.read('pipeline.json', PipelineConfigSchema, {});
  }

  index(): TextIndex {
    return this.read('texts/index.json', TextIndexSchema, { version: 1, updatedAt: new Date(0).toISOString(), texts: [] });
  }

  seen(today: string): Seen {
    const seen = this.read('state/seen.json', SeenSchema, { version: 1, urls: {} });
    const cutoff = new Date(`${today}T00:00:00Z`).getTime() - SEEN_REJECTED_DAYS * 86_400_000;
    // Stored texts stay deduped through index.json, so old entries of both kinds can go.
    for (const [k, v] of Object.entries(seen.urls)) {
      if (new Date(`${v.date}T00:00:00Z`).getTime() < cutoff) delete seen.urls[k];
    }
    return seen;
  }

  saveText(text: TextFile, index: TextIndex): IndexEntry {
    const rel = `texts/${text.date}/${text.id}.json`;
    this.write(rel, text);
    const entry: IndexEntry = {
      id: text.id,
      kind: text.kind,
      date: text.date,
      source: text.source,
      sourceName: text.sourceName,
      url: text.url,
      title: text.title,
      wordCount: text.wordCount,
      levelHeuristic: text.levelHeuristic,
      annotated: text.annotated,
      path: rel,
    };
    index.texts = [entry, ...index.texts.filter((t) => t.id !== text.id)];
    return entry;
  }

  saveIndex(index: TextIndex) {
    index.updatedAt = new Date().toISOString();
    this.write('texts/index.json', index);
  }

  saveSeen(seen: Seen) {
    this.write('state/seen.json', seen);
  }

  saveRunLog(log: unknown) {
    this.write('state/last-run.json', log);
  }
}

/** Today's date in Germany (the run date stored with each text). */
export function berlinDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
