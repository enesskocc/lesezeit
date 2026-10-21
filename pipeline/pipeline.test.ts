// Pipeline unit tests. All fixtures are synthetic — never put real news texts in this public repo.
//   npm run test:unit
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FsDictionary } from './dict-fs.ts';
import { extractArticle } from './extract.ts';
import { canonicalUrl, interleave, parseFeed, quickReject, urlHash } from './feeds.ts';
import { computeHeuristics, levelFromScore } from './heuristics.ts';
import { berlinDate, DataRepo } from './store.ts';
import { cleanParagraphs, splitSentences, words } from './text.ts';

const dict = new FsDictionary(path.resolve(import.meta.dirname, '../public/dict'));

test('sentence split keeps abbreviations, initials, ordinals and quotes together', () => {
  const p = 'Am 3. Oktober kam z. B. Herr J. Müller nach Berlin. Er blieb dort, d. h. zwei Tage. War das gut? „Ja“, sagte er.';
  assert.deepEqual(splitSentences(p), [
    'Am 3. Oktober kam z. B. Herr J. Müller nach Berlin.',
    'Er blieb dort, d. h. zwei Tage.',
    'War das gut?',
    '„Ja“, sagte er.',
  ]);
  assert.deepEqual(splitSentences('Ein Satz ohne Punkt'), ['Ein Satz ohne Punkt']);
  // Words that look like abbreviations, amounts and years end sentences.
  assert.deepEqual(splitSentences('Er sah das so. Danach ging er.'), ['Er sah das so.', 'Danach ging er.']);
  assert.deepEqual(splitSentences('Der Wert lag bei 12. Das ist viel.'), ['Der Wert lag bei 12.', 'Das ist viel.']);
  assert.deepEqual(splitSentences('Das gilt seit 2025. Danach kam mehr.'), ['Das gilt seit 2025.', 'Danach kam mehr.']);
  // Ordinals do not.
  assert.deepEqual(splitSentences('Seit dem 2. Weltkrieg und zum 5. Mal ist das so.'), ['Seit dem 2. Weltkrieg und zum 5. Mal ist das so.']);
});

test('paragraph cleanup drops boilerplate and caption fragments', () => {
  const out = cleanParagraphs([
    'Die Stadt hat gestern einen neuen Plan für den Nahverkehr vorgestellt.',
    'Mehr zum Thema: Busse und Bahnen',
    'Foto: Beispielagentur',
    'Ein kurzes Bild',
    '  Viele   Pendler hatten sich über lange Wartezeiten beschwert.  ',
    'Viele Pendler hatten sich über lange Wartezeiten beschwert.',
  ]);
  assert.deepEqual(out, [
    'Die Stadt hat gestern einen neuen Plan für den Nahverkehr vorgestellt.',
    'Viele Pendler hatten sich über lange Wartezeiten beschwert.',
  ]);
  assert.deepEqual(words('Die E-Mail kam 2026 an.'), ['Die', 'E-Mail', 'kam', 'an']);
});

test('RSS and Atom feeds are parsed; tracking parameters are dropped', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Erster Artikel</title><link>https://example.de/a.html?utm_source=rss#top</link><pubDate>Tue, 21 Oct 2026 06:00:00 GMT</pubDate></item>
    <item><title>Zweiter</title><guid>https://example.de/b.html</guid></item>
  </channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 2);
  assert.equal(canonicalUrl(items[0]!.url), 'https://example.de/a.html');
  assert.equal(urlHash(items[0]!.url), urlHash('https://example.de/a.html'));
  assert.equal(canonicalUrl('https://example.de/x?refresh=1&cidade=2&ref=rss&id=3'), 'https://example.de/x?refresh=1&cidade=2&id=3');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link rel="alternate" href="https://example.de/c"/><updated>2026-10-21</updated></entry></feed>`;
  assert.deepEqual(parseFeed(atom), [{ url: 'https://example.de/c', title: 'Atom', publishedAt: '2026-10-21' }]);
});

test('live blogs, media pages and paywall URLs are rejected before download', () => {
  assert.equal(quickReject({ url: 'https://example.de/liveblog-wahl-100.html', title: 'Wahl' }), 'live');
  assert.equal(quickReject({ url: 'https://example.de/a.html', title: '+++ Ticker +++ Lage' }), 'live');
  assert.equal(quickReject({ url: 'https://example.de/video/abc.html', title: 'x' }), 'media');
  assert.equal(quickReject({ url: 'https://www.zeit.de/zplus/2026/x', title: 'x' }), 'paywall');
  assert.equal(quickReject({ url: 'https://example.de/politik/plan-100.html', title: 'Plan' }), null);
});

const para = (n: number) =>
  `Die Verwaltung der Beispielstadt hat am Montag einen neuen Plan vorgestellt, der den Nahverkehr in den Abendstunden verbessern soll. Satz ${n} beschreibt weitere Einzelheiten, die für Pendler wichtig sind.`;
const page = (extraHead = '', lang = 'de') =>
  `<!doctype html><html lang="${lang}"><head><title>Neuer Plan | tagesschau.de</title>${extraHead}</head>
   <body><nav><a href="/">Start</a></nav><article><h1>Neuer Plan</h1>
   ${[1, 2, 3, 4, 5, 6].map((n) => `<p>${para(n)}</p>`).join('')}
   <figure><figcaption>Foto: Beispielagentur</figcaption></figure></article><footer>Impressum</footer></body></html>`;

test('article extraction: clean paragraphs, site name stripped from the title', () => {
  const ex = extractArticle(page(), 'https://example.de/plan.html', {});
  assert.ok(ex.ok);
  if (!ex.ok) return;
  assert.equal(ex.title, 'Neuer Plan');
  assert.equal(ex.paragraphs.length, 6);
  assert.ok(!ex.paragraphs.some((p) => p.includes('Foto:') || p.includes('Impressum')));
});

test('teaser link boxes, title echoes and footer lines are removed', () => {
  const html = `<!doctype html><html lang="de"><head><meta property="og:title" content="Neuer Plan für Busse"></head><body><article>
    <p>NeuerPlan für Busse</p>
    ${[1, 2, 3, 4].map((n) => `<p>${para(n)}</p>`).join('')}
    <p><a href="/other">Ganz andere Geschichte: Ein Teaser für einen anderen Artikel mit vielen Wörtern</a></p>
    <ul><li><a href="/x">Weiterer Link zu einem anderen Thema</a></li></ul>
    <p>Folgen Sie uns bei Instagram, TikTok, YouTube und Co.</p>
    <p>Diese Nachricht wurde am 21.10.2026 im Programm gesendet.</p>
  </article></body></html>`;
  const ex = extractArticle(html, 'https://example.de/p', {});
  assert.ok(ex.ok);
  if (!ex.ok) return;
  assert.equal(ex.paragraphs.length, 4, ex.paragraphs.join(' | '));
  assert.ok(ex.paragraphs[0]!.startsWith('Die Verwaltung'));
});

test('teaser boxes (by class), headings, kicker+title lines and agency signatures are removed', () => {
  const html = `<!doctype html><html lang="de"><head><meta property="og:title" content="Was eine Fusion bedeuten würde"></head><body><article>
    <p>Nach Musk-Bestätigung Was eine Fusion bedeuten würde</p>
    ${[1, 2, 3].map((n) => `<p>${para(n)}</p>`).join('')}
    <h2>Zwischenüberschrift ohne Satzzeichen am Ende hier</h2>
    <p>${para(4)}</p>
    <section class="teasergroup"><div class="teaser"><p>Nach Griechenland treffen Unwetter nun auch beliebte Urlaubsregionen in Spanien und anderswo.</p></div></section>
    <article class="teaser media-article"><div class="lead"><p>Die Gewalteskalation beim Protesttag hat das Land schwer erschüttert und viele Fragen aufgeworfen.</p></div></article>
    <p>Mehr zu den Protesten in Frankreich</p>
    <p>AR/gri (kna, afp, dpa, epd)</p>
  </article></body></html>`;
  const ex = extractArticle(html, 'https://example.de/p', {});
  assert.ok(ex.ok);
  if (!ex.ok) return;
  assert.equal(ex.paragraphs.length, 4, ex.paragraphs.join(' | '));
});

test('paywalled, live-blog and non-German pages are rejected', () => {
  const paywall = '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>';
  assert.deepEqual(extractArticle(page(paywall), 'https://example.de/p', {}), { ok: false, reason: 'paywall' });
  assert.deepEqual(extractArticle(page('<meta property="article:content_tier" content="locked">'), 'https://example.de/p', {}), {
    ok: false,
    reason: 'paywall',
  });
  assert.deepEqual(extractArticle(page('<i class="plus-badge"></i>'), 'https://example.de/p', { paywallMarkers: ['plus-badge'] }), {
    ok: false,
    reason: 'paywall',
  });
  const live = '<script type="application/ld+json">{"@type":"LiveBlogPosting"}</script>';
  assert.deepEqual(extractArticle(page(live), 'https://example.de/p', {}), { ok: false, reason: 'live' });
  assert.deepEqual(extractArticle(page('', 'en'), 'https://example.de/p', {}), { ok: false, reason: 'language' });
});

test('heuristics: passive, Konjunktiv, subordinate clauses, rare-word share', () => {
  const h = computeHeuristics(
    [
      'Das Haus wurde im letzten Jahr gebaut.',
      'Der Bürgermeister sagte, er habe keine Zeit.',
      'Sie bleibt zu Hause, weil es regnet.',
      'Die Stadt würde gern mehr Busse kaufen.',
    ],
    dict,
  );
  assert.equal(h.sentences, 4);
  assert.equal(h.passivePer100, 25);
  assert.equal(h.konjunktivPer100, 50);
  assert.equal(h.subordinatePerSentence, 0.25);
  assert.ok(h.rareShare >= 0 && h.rareShare < 0.3, `common words should be mostly frequent: ${h.rareShare}`);
  assert.ok(['B1', 'B2', 'C1', 'C2'].includes(levelFromScore(h.score)));
  assert.equal(levelFromScore(0), 'B1');
  assert.equal(levelFromScore(1), 'C2');
});

test('round-robin over sources gives variety', () => {
  assert.deepEqual(interleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']]), ['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
});

test('data repo: text + index written, old rejected URLs forgotten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesezeit-data-'));
  const repo = new DataRepo(dir);
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(
    path.join(dir, 'state/seen.json'),
    JSON.stringify({ version: 1, urls: { old: { date: '2026-08-01', status: 'rejected', reason: 'short' }, kept: { date: '2026-08-01', status: 'stored' } } }),
  );
  const seen = repo.seen('2026-10-21');
  assert.deepEqual(Object.keys(seen.urls), [], 'entries older than 30 days are forgotten');

  const index = repo.index();
  const h = computeHeuristics(['Ein Satz.'], dict);
  repo.saveText(
    {
      version: 1, id: 'abc123', kind: 'news', date: '2026-10-21', source: 'test', sourceName: 'Test', url: 'https://example.de/x',
      title: 'Titel', fetchedAt: '2026-10-21T03:30:00Z', wordCount: 2, paragraphs: ['Ein Satz.'], sentences: [{ p: 0, t: 'Ein Satz.' }],
      heuristics: h, levelHeuristic: 'B1', annotated: false,
    },
    index,
  );
  repo.saveIndex(index);
  assert.ok(fs.existsSync(path.join(dir, 'texts/2026-10-21/abc123.json')));
  assert.equal(repo.index().texts[0]?.path, 'texts/2026-10-21/abc123.json');
  assert.match(berlinDate(new Date('2026-10-21T23:30:00Z')), /^2026-10-22$/, 'Berlin is ahead of UTC');
  fs.rmSync(dir, { recursive: true, force: true });
});
