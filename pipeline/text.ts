// Plain-text helpers: paragraph cleanup, German sentence splitting, word tokens.

// Navigation/credit lines that Readability keeps but a reader does not want.
const BOILERPLATE = [
  /^(mehr zum thema|dieses thema im programm|lesen sie (auch|mehr)|mehr dazu|weitere informationen|hören sie|sehen sie)\b/i,
  /^(stand|quelle|foto|bild|video|audio|grafik|karte):/i,
  /^(mit material (von|der)|mit informationen (von|der)|hinweis der redaktion|anmerkung der redaktion|korrekturhinweis)\b/i,
  /^über (das|dieses) thema berichtete/i,
  /^mehr (zu|zum|zur|über) .{0,80}$/i,
  /newsletter (informiert|abonnieren|bestellen)/i,
  // Author/agency signature lines: "AR/gri (kna, afp, dpa, epd)", "dpa/AFP"
  /^[\p{L}/,.\s]{0,25}\((dpa|afp|ap|reuters|kna|epd|sid|dts|rtr|ard)[^)]*\)\.?$/iu,
  /^(dpa|afp|ap|reuters|kna|epd)(\s*[/,]\s*(dpa|afp|ap|reuters|kna|epd))*\.?$/i,
  /^(folgen sie uns|abonnieren sie|hier (abonnieren|anmelden|herunterladen)|jetzt (abonnieren|herunterladen))\b/i,
  /^diese nachricht wurde am .* gesendet/i,
  /(als (hinterlegte|bevorzugte) quelle|bevorzugte quelle einstellen|wer bei google etwas sucht)/i,
  /^→/,
  /^(dieser artikel|dieser beitrag|der artikel) (wurde|ist|wird)\b.*(aktualisiert|erschienen)/i,
  /©/,
];

const WORD = /\p{L}[\p{L}\p{M}'’-]*/gu;

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Normalizes whitespace/quotes and drops boilerplate and caption-like fragments. */
export function cleanParagraphs(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const p = r.normalize('NFC').replace(/­/g, '').replace(/\s+/g, ' ').trim();
    if (!p || BOILERPLATE.some((re) => re.test(p))) continue;
    const n = words(p).length;
    // Keep real prose; drop short fragments without sentence punctuation (captions, link lists).
    if (n < 6 && !/[.!?:“"»]$/.test(p)) continue;
    if (out.at(-1) === p) continue;
    out.push(p);
  }
  return out;
}

// Words before a "." that do not end a sentence.
const ABBREVIATIONS = new Set(
  (
    'z b d h u a o ä e g s v vgl bzw usw etc ca nr dr prof st str abs art mio mrd ggf inkl sog jh tel evtl bspw ' +
    'hr fr mr mrs gem lt max min rd ugs chr ff bzgl zt mind ehem geb gest jun sen dipl ing mag med phil rer nat ' +
    'jan feb febr apr aug sept sep okt nov dez kath ev zb dh ua uä'
  ).split(' '),
);
// Real words that are also abbreviations ("so", "Art", "Do") are deliberately not in the list:
// "Er sah das so. Danach …" must split.

const MONTHS = /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jahrhundert|Jahrhunderts)\b/;
// Words before "<n>." that make the number an ordinal: "am 3. Oktober", "der 2. Weltkrieg", "zum 5. Mal".
const ORDINAL_BEFORE = /\b(der|die|das|dem|den|des|am|im|zum|zur|vom|beim|ab|bis|seit|vor|nach|jeder|jede|jedes)$/i;

/** "3." before the next token: ordinal (no break) or a number ending the sentence? */
function isOrdinal(before: string, number: string, next: string): boolean {
  if (number.length > 2) return false; // years and amounts: "… seit 2025. Danach …"
  if (MONTHS.test(next)) return true;
  return ORDINAL_BEFORE.test(before.slice(0, before.length - number.length).trimEnd());
}

/**
 * German sentence split. Breaks after . ! ? (plus closing quotes/brackets) when the next
 * token starts like a new sentence. Does not break after abbreviations ("z. B."),
 * initials ("J. Smith") or ordinals ("am 3. Oktober", "der 2. Weltkrieg").
 */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+["“”»«')\]]*\s+(?=["„“»«(]?[\p{Lu}\d])/gu;
  let start = 0;
  for (const m of paragraph.matchAll(re)) {
    const end = m.index + m[0].length;
    const before = paragraph.slice(start, m.index);
    const lastToken = before.match(/([\p{L}\d]+)$/u)?.[1] ?? '';
    const isDot = m[0].startsWith('.');
    const next = paragraph.slice(end).replace(/^["„“»«(]/, '');
    if (
      isDot &&
      (ABBREVIATIONS.has(lastToken.toLowerCase()) ||
        /^\p{L}$/u.test(lastToken) ||
        (/^\d+$/.test(lastToken) && isOrdinal(before, lastToken, next)))
    ) {
      continue;
    }
    const s = paragraph.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
