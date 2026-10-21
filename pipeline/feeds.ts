// RSS 2.0 / Atom reading and candidate filtering (spec, content pipeline step 1).
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export const USER_AGENT = 'Mozilla/5.0 (compatible; LesezeitBot/0.1; +https://github.com/enesskocc/lesezeit; private reader)';

export interface FeedItem {
  url: string;
  title: string;
  publishedAt?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });

const text = (v: unknown): string => {
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (v && typeof v === 'object' && '#text' in v) return String((v as { '#text': unknown })['#text']).trim();
  return '';
};
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Parses an RSS 2.0 or Atom document into items (newest first, as the feed lists them). */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const items: FeedItem[] = [];
  for (const it of list(doc?.rss?.channel?.item)) {
    const url = text(it.link) || (it.guid?.['@isPermaLink'] !== 'false' ? text(it.guid) : '');
    if (url) items.push({ url, title: text(it.title), publishedAt: text(it.pubDate) || undefined });
  }
  for (const e of list(doc?.feed?.entry)) {
    const links = list(e.link) as Record<string, string>[];
    const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
    const url = alt?.['@href'] ?? '';
    if (url) items.push({ url, title: text(e.title), publishedAt: text(e.published) || text(e.updated) || undefined });
  }
  return items;
}

/** Canonical URL: no tracking parameters, no fragment. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) {
    // Prefix rule only for the utm_/at_/wt_ families; other names must match exactly
    // ("ref" yes, "refresh"/"reference" no — those can identify different pages).
    if (/^(utm_|at_|wt_)/i.test(k) || /^(xtor|ref|cid|fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

export function urlHash(url: string): string {
  return createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 10);
}

// Live blogs, tickers and media pages never become reading texts.
const LIVE_URL = /(liveblog|live-blog|liveticker|newsticker|livestream|\/live\/|\/ticker|-live-\d)/i;
const MEDIA_URL = /\/(video|videos|audio|audios|podcast|podcasts|multimedia|bilder|fotos?|galerie|bildergalerie|sendungen?)\//i;
const LIVE_TITLE = /(liveblog|live-?ticker|\+\+\+|\blive:|im überblick:|news-?ticker)/i;
const PAYWALL_URL = /(\/zplus\/|[?&]plus=|spiegel\.de\/.*\/plus\/|\/sz-plus\/)/i;

export type QuickReject = 'live' | 'media' | 'paywall' | null;

/** Cheap checks on URL/title before downloading the page. */
export function quickReject(item: FeedItem): QuickReject {
  if (LIVE_URL.test(item.url) || LIVE_TITLE.test(item.title)) return 'live';
  if (MEDIA_URL.test(item.url)) return 'media';
  if (PAYWALL_URL.test(item.url)) return 'paywall';
  return null;
}

export async function fetchText(url: string, timeoutMs = 20_000): Promise<{ status: number; body: string; type: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: res.ok ? await res.text() : '', type: res.headers.get('content-type') ?? '' };
}

/**
 * Round-robin over sources so one run gets variety instead of eight texts from the
 * same outlet. Within a source the feed order (newest first) is kept.
 */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out;
}
