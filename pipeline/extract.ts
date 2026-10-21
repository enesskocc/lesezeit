// Article extraction (spec, content pipeline step 2): Readability on jsdom, per-source
// selector as fallback; rejects paywalled pages, live blogs and non-German pages.
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Source } from '../shared/texts.ts';
import { cleanParagraphs } from './text.ts';

export type Extracted =
  | { ok: true; title: string; paragraphs: string[]; publishedAt?: string }
  | { ok: false; reason: 'paywall' | 'live' | 'extract' | 'language' };

// schema.org markup that publishers add for Google's paywall rules, plus common page markers.
const PAYWALL_PATTERNS = [
  /"isAccessibleForFree"\s*:\s*(false|"false"|"False")/,
  /<meta[^>]+property=["']article:content_tier["'][^>]+content=["'](locked|subscriber)["']/i,
  /<meta[^>]+content=["'](locked|subscriber)["'][^>]+property=["']article:content_tier["']/i,
];
const LIVE_PATTERNS = [/"@type"\s*:\s*"LiveBlogPosting"/];

// A few very common German words; a German article contains many of them.
const GERMAN_HINTS = /\b(und|der|die|das|nicht|ist|mit|auf|für|sich|dem|den|eine?)\b/gi;

function stripSiteName(title: string): string {
  return title.replace(/\s*[|–—-]\s*(tagesschau(\.de)?|zdfheute|ZDF|DW|Deutsche Welle|BR24|MDR(\.DE)?|SWR( Aktuell)?|Deutschlandfunk|ZEIT ONLINE|DER SPIEGEL|Süddeutsche Zeitung|SZ\.de)\s*$/i, '').trim();
}

function metaContent(doc: Document, prop: string): string | undefined {
  return doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute('content') ?? undefined;
}

/** Share of an element's text that sits inside links. Teaser boxes for other articles are ~1. */
function linkDensity(el: Element): number {
  const total = (el.textContent ?? '').replace(/\s+/g, '').length;
  if (!total) return 0;
  const linked = [...el.querySelectorAll('a')].reduce((n, a) => n + (a.textContent ?? '').replace(/\s+/g, '').length, 0);
  return linked / total;
}

// Boxes for other articles, newsletters and sharing. Removed before Readability runs, because
// Readability strips class names from its output.
const NOISE = [
  'figure', 'aside', 'nav', 'footer', 'form', '[aria-hidden="true"]',
  '[class*="teaser" i]', '[class*="related" i]', '[class*="recommend" i]', '[class*="newsletter" i]',
  '[class*="social" i]', '[class*="share" i]', '[class*="promo" i]', '[class*="banner" i]',
].join(', ');

function stripNoise(doc: Document) {
  for (const el of doc.body?.querySelectorAll(NOISE) ?? []) {
    // Never remove the element that holds the article itself (some sites put "teaser" in its class).
    // Teaser boxes can be <article> elements too (SWR), so size decides, not the tag.
    if (el.matches('main, body') || el.querySelectorAll('p').length > 8) continue;
    el.remove();
  }
}

// Headings are left out: inside articles they are mostly titles of other articles.
function paragraphsOf(root: ParentNode): string[] {
  return [...root.querySelectorAll('p, li, blockquote')]
    .filter((el) => !el.closest('figure, figcaption, aside, nav, footer, table'))
    // A <p> inside <blockquote>/<li> would otherwise be counted twice.
    .filter((el) => !(el.tagName !== 'P' && el.querySelector('p')))
    // Link lists and "read also" teasers; a real paragraph has at most a few links.
    .filter((el) => linkDensity(el) <= 0.5 && !el.closest('a'))
    .map((el) => el.textContent ?? '');
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]/gu, '');

/** Drops leading paragraphs that repeat the headline (often "KickerHeadline" without a space). */
function dropTitleEcho(paragraphs: string[], title: string): string[] {
  const t = letters(title);
  let i = 0;
  const echo = (p: string) => {
    const l = letters(p);
    // "Title", "Kicker" alone, or "Kicker Title" as one line.
    return l === t || ((t.includes(l) || l.endsWith(t)) && p.length < 200);
  };
  while (i < paragraphs.length && i < 2 && t && echo(paragraphs[i]!)) i++;
  return paragraphs.slice(i);
}

export function extractArticle(html: string, url: string, source: Pick<Source, 'selector' | 'paywallMarkers'>): Extracted {
  if (PAYWALL_PATTERNS.some((re) => re.test(html)) || source.paywallMarkers?.some((m) => html.includes(m))) {
    return { ok: false, reason: 'paywall' };
  }
  if (LIVE_PATTERNS.some((re) => re.test(html))) return { ok: false, reason: 'live' };

  const virtualConsole = new VirtualConsole(); // swallow jsdom CSS/script noise
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  const lang = doc.documentElement.getAttribute('lang') ?? '';
  const publishedAt = metaContent(doc, 'article:published_time') ?? doc.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
  const ogTitle = metaContent(doc, 'og:title');
  stripNoise(doc);

  // Selector first when the source defines one (more precise), Readability otherwise.
  let paragraphs: string[] = [];
  if (source.selector) {
    const root = doc.querySelector(source.selector);
    if (root) paragraphs = cleanParagraphs(paragraphsOf(root));
  }
  let title = ogTitle ?? doc.title;
  if (paragraphs.length < 3) {
    const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse();
    if (article?.content) {
      const content = new JSDOM(article.content, { virtualConsole }).window.document;
      paragraphs = cleanParagraphs(paragraphsOf(content.body));
      title = ogTitle ?? article.title ?? title;
    }
  }
  dom.window.close();

  paragraphs = dropTitleEcho(paragraphs, stripSiteName(title ?? ''));
  if (paragraphs.length === 0) return { ok: false, reason: 'extract' };
  const sample = paragraphs.join(' ').slice(0, 4000);
  const germanHits = sample.match(GERMAN_HINTS)?.length ?? 0;
  if ((lang && !lang.toLowerCase().startsWith('de')) || germanHits < sample.split(/\s+/).length * 0.08) {
    return { ok: false, reason: 'language' };
  }
  return { ok: true, title: stripSiteName(title ?? ''), paragraphs, publishedAt };
}
