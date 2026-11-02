import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { ANSWER_FILE_SCHEMA, parseAnswerFile, parseElementId, readingFromAnswer } from '../src/answerFile.js';
import { assess } from '../src/check.js';
import { decodeHtml, htmlToText } from '../src/html.js';
import { JOB_FOLDERS, jobFile } from '../src/jobFile.js';

const SITE = 'https://www.sonnenschein.example/';

const HTML = `<!doctype html><html><head><title>Bäckerei</title><style>p{color:red}</style>
<script>window.data = {"phone": "+49 999"};</script></head>
<body>
  <nav><a href="/kontakt">Kontakt</a> <a href="#top">nach oben</a></nav>
  <h1>Bäckerei Sonnenschein</h1>
  <p>Öffnungszeiten:<br>Montag&nbsp;bis Freitag 6&ndash;18&nbsp;Uhr</p>
  <p>E-Mail: <a href="mailto:info@sonnenschein.example">schreiben Sie uns</a></p>
  <footer><a href='https://www.instagram.com/sonnenschein_ilmenau/'><svg><path d="M0"/></svg> Instagram</a>
  &copy; 2026 &#8211; &#x2764;</footer>
  <!-- <p>alt: Telefon 0123</p> -->
</body></html>`;

describe('htmlToText', () => {
  const text = htmlToText(HTML, SITE);

  it('keeps the visible text and decodes entities', () => {
    expect(text).toContain('Öffnungszeiten:\nMontag bis Freitag 6–18 Uhr');
    expect(text).toContain('© 2026 – ❤');
  });

  it('keeps link addresses, absolute', () => {
    expect(text).toContain('Kontakt (https://www.sonnenschein.example/kontakt)');
    expect(text).toContain('schreiben Sie uns (mailto:info@sonnenschein.example)');
    expect(text).toContain('Instagram (https://www.instagram.com/sonnenschein_ilmenau/)');
    expect(text).not.toContain('#top');
  });

  it('drops scripts, styles, head and comments', () => {
    expect(text).not.toMatch(/window\.data|color:red|Telefon 0123|<title>/);
  });

  // parked domains often say it only in the title (first real run, 2026-11-02)
  it('keeps the title', () => {
    expect(text.startsWith('Bäckerei\n')).toBe(true);
  });
});

const answerJson = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'osmcorrection-assist-answer',
    version: 1,
    ai: { vendor: 'OpenAI', model: 'gpt-x', tool: 'Codex CLI' },
    job: 'a1',
    elements: ['node/42', 'way/4711'],
    url: SITE,
    fetched_with: 'browser',
    pages: [
      { url: SITE, file: 'seiten/a1-1.html' },
      { url: `${SITE}zeiten`, error: 'HTTP 404' },
    ],
    proposals: [
      {
        field: 'opening_hours',
        network: 'none',
        value: 'Mo-Fr 06:00-18:00',
        quote: 'Montag bis Freitag 6-18 Uhr',
        source_url: SITE,
      },
      {
        field: 'social',
        network: 'instagram',
        value: 'https://www.instagram.com/sonnenschein_ilmenau/',
        quote: 'Instagram (https://www.instagram.com/sonnenschein_ilmenau/)',
        source_url: SITE,
      },
    ],
    signals: [],
    ...fields,
  });

describe('schema file', () => {
  it('is the schema of the code (npm run schema)', () => {
    const file = JSON.parse(readFileSync(new URL('../schema/answer-file.schema.json', import.meta.url), 'utf8')) as unknown;
    expect(file).toEqual(ANSWER_FILE_SCHEMA);
  });

  it('is a valid JSON Schema that requires "ai"', () => {
    const validate = new Ajv2020({ strict: true, strictRequired: false }).compile(ANSWER_FILE_SCHEMA);
    const answer = JSON.parse(answerJson()) as Record<string, unknown>;
    expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...answer, ai: undefined })).toBe(false);
    expect(validate({ ...answer, ai: { vendor: '', model: 'x', tool: 'y' } })).toBe(false);
  });
});

describe('decodeHtml', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('reads UTF-8, also with a byte order mark', () => {
    expect(decodeHtml(new TextEncoder().encode('Bäckerei'))).toBe('Bäckerei');
    expect(decodeHtml(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('A');
  });

  it('reads UTF-16 from a PowerShell redirect', () => {
    expect(decodeHtml(bytes(0xff, 0xfe, 0x42, 0x00, 0xe4, 0x00))).toBe('Bä');
  });

  it('uses the declared charset if the page is not UTF-8', () => {
    const latin1 = [...'<meta charset="iso-8859-1"><p>B'].map((c) => c.charCodeAt(0));
    expect(decodeHtml(bytes(...latin1, 0xe4, 0x63, 0x6b))).toContain('Bäck');
  });
});

describe('parseAnswerFile', () => {
  it('reads who wrote it', () => {
    expect(parseAnswerFile(answerJson()).ai).toEqual({ vendor: 'OpenAI', model: 'gpt-x', tool: 'Codex CLI' });
    expect(parseAnswerFile(answerJson({ ai: undefined })).ai).toBeUndefined();
    expect(parseAnswerFile(answerJson({ ai: { vendor: ' Google ' } })).ai).toEqual({ vendor: 'Google', model: 'unknown', tool: 'unknown' });
  });

  it('reads an answer file', () => {
    const answer = parseAnswerFile(answerJson());
    expect(answer.elements).toEqual([
      { type: 'node', id: 42 },
      { type: 'way', id: 4711 },
    ]);
    expect(answer.proposals).toHaveLength(2);
  });

  it('names what is wrong', () => {
    expect(() => parseAnswerFile('{')).toThrow(/JSON/);
    expect(() => parseAnswerFile(answerJson({ format: 'x' }))).toThrow(/format/);
    expect(() => parseAnswerFile(answerJson({ elements: ['node:42'] }))).toThrow(/node\/42/);
    expect(() => parseAnswerFile(answerJson({ proposals: [{ field: 'name' }] }))).toThrow(
      /proposals\[0\]: "field" must be one of opening_hours/,
    );
    expect(() => parseAnswerFile(answerJson({ signals: [{ kind: 'gone', quote: 'x', source_url: SITE }] }))).toThrow(
      /signals\[0\]: "kind" must be one of closed/,
    );
  });

  // first real run in Claude Code (2026-11-02): "signal" instead of "kind"
  it('accepts "signal" as the kind of a signal', () => {
    const json = readFileSync(new URL('./fixtures/answer-signal-key.json', import.meta.url), 'utf8');
    const answer = parseAnswerFile(json);
    expect(answer.signals).toEqual([
      {
        kind: 'closed',
        quote: 'müssen wir das Ilmenauer Bowlingcenter leider zum 31.03.2026 schließen.',
        source_url: 'https://ilmbowl.de/',
      },
    ]);
    expect(answer.proposals).toHaveLength(3);
  });

  it('parses element IDs', () => {
    expect(parseElementId(' relation/7 ')).toEqual({ type: 'relation', id: 7 });
    expect(parseElementId('n42')).toBeUndefined();
  });
});

describe('readingFromAnswer', () => {
  const answer = parseAnswerFile(answerJson());

  it('checks the quotes against the saved pages', () => {
    const reading = readingFromAnswer(answer, new Map([['seiten/a1-1.html', HTML]]), 'Anthropic');
    const request = { element: { type: 'node' as const, id: 42, tags: {} }, url: SITE, today: '2026-11-02' };
    const result = assess(reading, request);
    expect(result.proposals.map((p) => p.key)).toEqual(['opening_hours', 'contact:instagram']);
    expect(result.pages).toEqual([{ url: SITE }, { url: `${SITE}zeiten`, error: 'HTTP 404' }]);
    // the vendor the user confirmed wins over the one the answer states
    expect(result.model.vendor).toBe('Anthropic');
    expect(readingFromAnswer(answer, new Map()).model).toEqual({ vendor: 'OpenAI', name: 'gpt-x (Codex CLI)', id: 'gpt-x' });
  });

  it('rejects quotes from a missing page file', () => {
    const reading = readingFromAnswer(answer, new Map());
    expect(reading.pages[0]?.error).toMatch(/missing/);
    const request = { element: { type: 'node' as const, id: 42, tags: {} }, url: SITE, today: '2026-11-02' };
    expect(assess(reading, request).rejected.map((r) => r.reason)).toEqual(['quote_not_found', 'quote_not_found']);
  });

  it('treats an empty page file as not fetched', () => {
    const reading = readingFromAnswer(answer, new Map([['seiten/a1-1.html', '  \n']]));
    expect(reading.pages[0]?.error).toMatch(/empty/);
  });

  it('finds files with Windows separators', () => {
    const windows = parseAnswerFile(answerJson({ pages: [{ url: SITE, file: '.\\seiten\\a1-1.html' }] }));
    expect(readingFromAnswer(windows, new Map([['seiten/a1-1.html', HTML]])).pages).toEqual([{ url: SITE }]);
  });
});

describe('jobFile', () => {
  const text = jobFile({
    jobs: [
      { id: 'a1', elements: [{ type: 'node', id: 42 }, { type: 'way', id: 4711 }] },
      { id: 'a2', elements: [{ type: 'relation', id: 7 }] },
    ],
    today: '2026-11-02',
    part: 'Teil 1 von 2',
  });

  it('lists the jobs with their element IDs', () => {
    expect(text).toContain('- a1: node/42, way/4711\n- a2: relation/7');
    expect(text).toContain('(Teil 1 von 2)');
  });

  const block = (heading: string) => new RegExp(`### ${heading}\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(text)?.[1] ?? '';

  it('contains the JSON Schema of the answer file', () => {
    expect(JSON.parse(block('JSON-Schema'))).toEqual(ANSWER_FILE_SCHEMA);
  });

  it('keeps the hyphen before a phone extension', () => {
    expect(text).toContain('`+49 3677 6414-0`, nicht `+49 3677 64140`');
  });

  it('asks for the maker of the model, not of the tool', () => {
    expect(text).toContain('Läuft ein Claude-Modell in Kiro, ist das `Anthropic`.');
    expect(text).not.toMatch(/Ergebnis aus Claude Code importieren/);
  });

  it('contains an example that matches the schema and the import', () => {
    const example = block('Beispiel');
    const validate = new Ajv2020({ strict: false }).compile(ANSWER_FILE_SCHEMA);
    expect(validate(JSON.parse(example)), JSON.stringify(validate.errors)).toBe(true);
    expect(parseAnswerFile(example).job).toBe('a1');
  });

  // the schema would have caught the first real run: "signal" instead of "kind"
  it('rejects the answers of the first run by schema', () => {
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(ANSWER_FILE_SCHEMA);
    const real = JSON.parse(readFileSync(new URL('./fixtures/answer-signal-key.json', import.meta.url), 'utf8')) as unknown;
    expect(validate(real)).toBe(false);
    expect(validate.errors?.some((e) => e.instancePath === '/signals/0')).toBe(true);
  });

  it('gives browser commands with an absolute profile path', () => {
    // a relative --user-data-dir makes Edge show an error dialog (2026-11-02)
    expect(text).toContain('--user-data-dir="$(cygpath -w "$PWD/browser")"');
    expect(text).toContain(`"--user-data-dir=""$PWD\\browser"""`);
    expect(text).toContain('-RedirectStandardOutput "$PWD\\seiten\\a1-1.html" -Wait');
    expect(text).not.toContain('--user-data-dir=browser');
  });

  it('is German by default', () => {
    expect(text).toMatch(/^# Auftrag: /);
    expect(jobFile({ jobs: [], today: '2026-11-02', language: 'de' })).toMatch(/^# Auftrag: /);
  });
});

describe('jobFile in English', () => {
  const text = jobFile({
    jobs: [{ id: 'a1', elements: [{ type: 'node', id: 42 }] }],
    today: '2026-11-02',
    part: 'part 1 of 2',
    language: 'en',
  });
  const block = (heading: string) => new RegExp(`### ${heading}\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(text)?.[1] ?? '';

  it('has the English instructions, folders and job list', () => {
    expect(text).toMatch(/^# Job: analyze websites for OpenStreetMap \(part 1 of 2\)/);
    expect(text).toContain('“Work through job.md”');
    expect(text).toContain('answers/<job>.json');
    expect(text).toContain('> pages/a1-1.html');
    expect(text).not.toMatch(/seiten\/|antworten\/|Auftrag/);
    expect(text).toContain('- a1: node/42');
  });

  it('keeps the rules on extensions and the maker of the model', () => {
    expect(text).toContain('`+49 3677 6414-0`, not\n  `+49 3677 64140`');
    expect(text).toContain('A Claude model running in Kiro is `Anthropic`.');
  });

  it('contains the same schema and an example that matches it', () => {
    expect(JSON.parse(block('JSON Schema'))).toEqual(ANSWER_FILE_SCHEMA);
    const validate = new Ajv2020({ strict: false }).compile(ANSWER_FILE_SCHEMA);
    const example = block('Example');
    expect(validate(JSON.parse(example)), JSON.stringify(validate.errors)).toBe(true);
    expect(parseAnswerFile(example).pages[0]).toEqual({ url: 'https://www.example-bakery.com/', file: 'pages/a1-1.html' });
  });

  it('names the files of the working folder', () => {
    expect(JOB_FOLDERS.en).toEqual({ file: 'job.md', pages: 'pages', answers: 'answers' });
    expect(JOB_FOLDERS.de).toEqual({ file: 'auftrag.md', pages: 'seiten', answers: 'antworten' });
  });
});
