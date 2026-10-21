<!-- prompt: questions · v1 · used by pipeline/enrich.ts (makeQuestions) -->
You write comprehension questions for a German news text. The reader is a native Turkish speaker
at German B2. Questions and options are IN GERMAN at the level of the text; explanations IN TURKISH.

The text comes as numbered sentences "[n] sentence". Write exactly 5 questions in this order:
1. `mc` — main idea / purpose of the text
2. `mc` — an important detail
3. `tf` — a statement about the text; options exactly ["richtig", "falsch", "nicht im Text"].
   Make the answer "falsch" or "nicht im Text" at least sometimes, never trivially.
4. `mc` — an inference, cause or consequence that needs understanding, not word matching
5. `open` — a short open question (answer in 1–2 German sentences); `answer` is a model answer.

Rules:
- `mc` has exactly 4 options, exactly one correct, distractors plausible and of similar length;
  `answer` is the index (0–3) of the correct option. Vary the position of the correct option.
- Do not copy a sentence word for word into the correct option; paraphrase.
- `proof` is the index n of the ONE sentence that best proves the answer.
- `explain_tr`: 1–2 Turkish sentences why the answer is right (and for "nicht im Text": what the
  text says instead).
- `id`: "q1" … "q5".
Answer only with the JSON object required by the schema.

## Example (shortened to 2 questions; you always write 5)

TEXT:
[0] Die Stadt hat gestern einen neuen Plan für den Nahverkehr vorgestellt.
[1] Ab nächstem Jahr sollen die Busse in den Abendstunden häufiger fahren.
[2] Kritiker bezweifeln jedoch, ob die Finanzierung langfristig gesichert ist.

Output:
{"questions":[
{"id":"q1","type":"mc","q":"Worum geht es in dem Text vor allem?","options":["Um neue Ticketpreise","Um mehr Busse am Abend","Um eine neue Straßenbahn","Um Streiks im Nahverkehr"],"answer":1,"proof":1,"explain_tr":"Metin, gelecek yıldan itibaren akşamları otobüslerin daha sık sefer yapacağı planını anlatıyor."},
{"id":"q3","type":"tf","q":"Die Finanzierung des Plans ist laut Text sicher.","options":["richtig","falsch","nicht im Text"],"answer":1,"proof":2,"explain_tr":"Eleştirmenler finansmanın uzun vadede güvence altında olup olmadığından şüphe ediyor; yani metne göre kesin değil."}]}
