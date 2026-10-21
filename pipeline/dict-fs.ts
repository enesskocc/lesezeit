// Dictionary access for Node (pipeline): same shard files and rules as the app, read from disk.
import fs from 'node:fs';
import path from 'node:path';
import {
  FormShardSchema,
  lemmaId,
  LemmaShardSchema,
  ManifestSchema,
  normalizeKey,
  parseLemmaId,
  shardFile,
  shardFor,
  type LemmaEntry,
} from '../shared/dict.ts';

export interface WordInfo {
  known: boolean;
  /** Best (lowest) frequency rank among all lemmas this word form can belong to. */
  rank?: number;
  /** Lemma entries this form belongs to (as itself or as an inflected form). */
  entries: LemmaEntry[];
}

export class FsDictionary {
  private readonly dir: string;
  private readonly prefixes: { forms: Set<string>; lemmas: Set<string> };
  private readonly shards = new Map<string, Record<string, unknown[]>>();
  private readonly memo = new Map<string, WordInfo>();

  constructor(dir: string) {
    this.dir = dir;
    const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
    this.prefixes = { forms: new Set(Object.keys(manifest.forms)), lemmas: new Set(Object.keys(manifest.lemmas)) };
  }

  private value<T>(kind: 'forms' | 'lemmas', key: string): T[] {
    const prefix = shardFor(key, this.prefixes[kind]);
    if (!prefix) return [];
    const file = `${kind}/${shardFile(prefix)}`;
    let shard = this.shards.get(file);
    if (!shard) {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, `${file}.json`), 'utf8'));
      shard = (kind === 'forms' ? FormShardSchema : LemmaShardSchema).parse(raw) as Record<string, unknown[]>;
      this.shards.set(file, shard);
    }
    return (Object.hasOwn(shard, key) ? shard[key] : []) as T[];
  }

  /** Everything the dictionary knows about a word form, e.g. "Häusern" → Haus. */
  info(word: string): WordInfo {
    const key = normalizeKey(word);
    const cached = this.memo.get(key);
    if (cached) return cached;
    const entries = [...this.value<LemmaEntry>('lemmas', key)];
    for (const id of this.value<string>('forms', key)) {
      const { w } = parseLemmaId(id);
      const e = this.value<LemmaEntry>('lemmas', normalizeKey(w)).find((x) => lemmaId(x) === id);
      if (e && !entries.includes(e)) entries.push(e);
    }
    const ranks = entries.map((e) => e.rank).filter((r): r is number => r !== undefined);
    const info: WordInfo = { known: entries.length > 0, rank: ranks.length ? Math.min(...ranks) : undefined, entries };
    this.memo.set(key, info);
    return info;
  }
}
