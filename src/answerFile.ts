import { isRawAnswer } from './check.js';
import { htmlToText } from './html.js';
import { ANSWER_SCHEMA } from './prompt.js';
import { FIELDS, NETWORKS, SIGNAL_KINDS, type FetchedPage, type RawAnswer, type SiteReading } from './types.js';

/*
 * Analysis outside the app by an AI agent on the user's computer, e.g. Claude
 * Code with the user's Claude plan (docs/answer-file.md): the app exports a
 * job file with the element IDs, the agent saves the pages and writes one
 * answer file per job, and the app imports them. The checks are the same as
 * for the API.
 */

export const ANSWER_FORMAT = 'osmcorrection-assist-answer';

/** Where the schema file is published (schema/answer-file.schema.json in this repository). */
export const ANSWER_FILE_SCHEMA_ID = 'https://raw.githubusercontent.com/cyper85/osmAssist/master/schema/answer-file.schema.json';

export interface ElementId {
  type: 'node' | 'way' | 'relation';
  id: number;
}

export interface AnswerPage {
  url: string;
  /** the address actually received, if the site redirected */
  final_url?: string;
  /** the saved HTML, relative to the working folder */
  file?: string;
  error?: string;
}

/** The AI that wrote the answer, as it states itself. */
export interface AnswerAi {
  /** maker of the model, e.g. "Anthropic", "OpenAI", "Google" (not the maker of the tool) */
  vendor: string;
  /** e.g. "claude-opus-5-5" */
  model: string;
  /** the agent it ran in, e.g. "Claude Code", "Kiro", "Codex CLI" */
  tool: string;
}

export interface AnswerFile extends RawAnswer {
  format: typeof ANSWER_FORMAT;
  version: 1;
  /** required by the schema; older answers (first run, 2026-11-02) do not have it */
  ai?: AnswerAi;
  job: string;
  elements: ElementId[];
  url: string;
  fetched_with?: string;
  pages: AnswerPage[];
}

/**
 * JSON Schema of an answer file, given to the model in the job file. The
 * entries of `proposals` and `signals` are the ones of the API (ANSWER_SCHEMA).
 */
export const ANSWER_FILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: ANSWER_FILE_SCHEMA_ID,
  title: 'osmAssist answer file',
  description:
    'What an AI agent found on the website of one job (one website, one or more OpenStreetMap elements). See docs/answer-file.md.',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version', 'ai', 'job', 'elements', 'url', 'fetched_with', 'pages', 'proposals', 'signals'],
  properties: {
    format: { const: ANSWER_FORMAT },
    version: { const: 1 },
    ai: {
      type: 'object',
      description: 'The AI that wrote this answer. Used for the changeset tag ai_assisted, after the user confirmed it.',
      additionalProperties: false,
      required: ['vendor', 'model', 'tool'],
      properties: {
        vendor: {
          type: 'string',
          minLength: 1,
          description: 'Maker of the model (not of the tool), e.g. "Anthropic", "OpenAI", "Google", "Amazon".',
        },
        model: { type: 'string', minLength: 1, description: 'The model, e.g. "claude-opus-5-5"; "unknown" if not known.' },
        tool: { type: 'string', minLength: 1, description: 'The agent it ran in, e.g. "Claude Code", "Kiro", "Codex CLI".' },
      },
    },
    job: { type: 'string', description: 'ID of the job, e.g. "a1".' },
    elements: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: '^(node|way|relation)/[0-9]+$' },
      description: 'The elements of the job, as in the job list.',
    },
    url: { type: 'string', description: 'The website from the OpenStreetMap data.' },
    fetched_with: { enum: ['browser', 'curl'], description: 'How the pages were saved.' },
    pages: {
      type: 'array',
      description: 'Every page fetched, with "file" (saved) or "error" (could not be fetched).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: { type: 'string' },
          final_url: {
            type: 'string',
            description: 'The address actually received, if the page redirected (e.g. to another domain); omit otherwise.',
          },
          // seiten/ in German job files, pages/ in English ones (JOB_FOLDERS)
          file: { type: 'string', pattern: '^(seiten|pages)/[^/]+\\.html$' },
          error: { type: 'string' },
        },
        oneOf: [{ required: ['file'] }, { required: ['error'] }],
      },
    },
    proposals: ANSWER_SCHEMA.properties.proposals,
    signals: ANSWER_SCHEMA.properties.signals,
  },
} as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** "node/42" → { type: 'node', id: 42 } */
export function parseElementId(text: string): ElementId | undefined {
  const match = /^(node|way|relation)\/(\d+)$/.exec(text.trim());
  return match === null ? undefined : { type: match[1] as ElementId['type'], id: Number(match[2]) };
}

/** Reads an answer file; throws with a reason if it does not have the format. */
export function parseAnswerFile(json: string): AnswerFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('not valid JSON');
  }
  if (!isObject(data) || data.format !== ANSWER_FORMAT || data.version !== 1) {
    throw new Error(`not an answer file (format "${ANSWER_FORMAT}", version 1)`);
  }
  if (typeof data.job !== 'string' || typeof data.url !== 'string') {
    throw new Error('"job" or "url" missing');
  }
  const elements = Array.isArray(data.elements)
    ? data.elements.map((e) => (typeof e === 'string' ? parseElementId(e) : undefined))
    : [];
  if (elements.length === 0 || elements.some((e) => e === undefined)) {
    throw new Error('"elements" must list IDs like "node/42"');
  }
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const pageOk = (p: unknown) =>
    isObject(p) &&
    typeof p.url === 'string' &&
    (p.final_url === undefined || typeof p.final_url === 'string') &&
    (p.file === undefined || typeof p.file === 'string') &&
    (p.error === undefined || typeof p.error === 'string');
  if (!pages.every(pageOk)) {
    throw new Error('"pages" must have "url" and "file" or "error"');
  }
  // models sometimes name the kind of a signal "signal" or "type" (first run, 2026-11-02)
  const signals = Array.isArray(data.signals)
    ? data.signals.map((s) => (isObject(s) && s.kind === undefined ? { ...s, kind: s.signal ?? s.type } : s))
    : data.signals;
  const answer = {
    proposals: data.proposals,
    signals: Array.isArray(signals)
      ? signals.map((s) =>
          isObject(s) ? { kind: s.kind, quote: s.quote, source_url: s.source_url, note: typeof s.note === 'string' ? s.note : '' } : s,
        )
      : signals,
  };
  if (!isRawAnswer(answer)) {
    throw new Error(schemaProblem(answer.proposals, answer.signals));
  }
  const ai = isObject(data.ai) && typeof data.ai.vendor === 'string' && data.ai.vendor.trim() !== '' ? data.ai : undefined;
  return {
    format: ANSWER_FORMAT,
    version: 1,
    ...(ai === undefined
      ? {}
      : {
          ai: {
            vendor: String(ai.vendor).trim(),
            model: typeof ai.model === 'string' ? ai.model : 'unknown',
            tool: typeof ai.tool === 'string' ? ai.tool : 'unknown',
          },
        }),
    job: data.job,
    elements: elements as ElementId[],
    url: data.url,
    ...(typeof data.fetched_with === 'string' ? { fetched_with: data.fetched_with } : {}),
    pages: pages as AnswerPage[],
    ...answer,
  };
}

/** Names the first entry that does not match the schema, e.g. 'signals[0]: "kind" …'. */
function schemaProblem(proposals: unknown, signals: unknown): string {
  const fields = (entry: Record<string, unknown>, rules: [string, (v: unknown) => boolean, string][]) =>
    rules.find(([name, ok]) => !ok(entry[name]));
  const text = (v: unknown) => typeof v === 'string';
  const listCheck = (
    name: string,
    list: unknown,
    rules: [string, (v: unknown) => boolean, string][],
  ): string | undefined => {
    if (!Array.isArray(list)) {
      return `"${name}" must be a list`;
    }
    for (const [i, entry] of list.entries()) {
      if (!isObject(entry)) {
        return `${name}[${i}] is not an object`;
      }
      const wrong = fields(entry, rules);
      if (wrong !== undefined) {
        return `${name}[${i}]: "${wrong[0]}" ${wrong[2]}`;
      }
    }
    return undefined;
  };
  const oneOf = (list: readonly string[]) => (v: unknown) => typeof v === 'string' && list.includes(v);
  return (
    listCheck('proposals', proposals, [
      ['field', oneOf(FIELDS), `must be one of ${FIELDS.join(', ')}`],
      ['network', oneOf(['none', ...NETWORKS]), 'must be "none" or a network'],
      ['value', text, 'must be a text'],
      ['quote', text, 'must be a text'],
      ['source_url', text, 'must be a text'],
    ]) ??
    listCheck('signals', signals, [
      ['kind', oneOf(SIGNAL_KINDS), `must be one of ${SIGNAL_KINDS.join(', ')}`],
      ['quote', text, 'must be a text'],
      ['source_url', text, 'must be a text'],
    ]) ??
    '"proposals" or "signals" do not match the schema'
  );
}

/** Normalizes a path inside the working folder ("./seiten\\a1.html" → "seiten/a1.html"). */
export function folderPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * The reading of one answer file, with the text of its saved pages. A page
 * whose file is missing counts as not fetched, so its quotes are rejected.
 * `vendor` is the maker of the model as confirmed by the user; without it,
 * the one the answer states.
 */
export function readingFromAnswer(answer: AnswerFile, files: Map<string, string>, vendor?: string): SiteReading {
  const texts: Record<string, string> = {};
  const pages: FetchedPage[] = answer.pages.map((page) => {
    if (page.file === undefined) {
      return { url: page.url, error: page.error ?? 'not fetched' };
    }
    const html = files.get(folderPath(page.file));
    if (html === undefined) {
      return { url: page.url, error: `file missing: ${page.file}` };
    }
    if (html.trim() === '') {
      return { url: page.url, error: `file empty: ${page.file}` };
    }
    const text = htmlToText(html, page.url);
    texts[page.url] = text;
    // the quotes may name the address of a redirect as their source
    if (page.final_url !== undefined && page.final_url !== page.url) {
      texts[page.final_url] = text;
      return { url: page.url, finalUrl: page.final_url };
    }
    return { url: page.url };
  });
  return {
    url: answer.url,
    answer: { proposals: answer.proposals, signals: answer.signals },
    texts,
    pages,
    model: {
      vendor: vendor ?? answer.ai?.vendor ?? 'unknown',
      name: answer.ai === undefined ? 'unknown' : `${answer.ai.model} (${answer.ai.tool})`,
      id: answer.ai?.model ?? 'unknown',
    },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
