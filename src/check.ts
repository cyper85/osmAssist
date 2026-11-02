import { bareUrl, containsQuote, onSite, siteHost } from './text.js';
import {
  FIELDS,
  NETWORKS,
  SIGNAL_KINDS,
  type AssistRequest,
  type AssistResult,
  type Field,
  type Proposal,
  type RawAnswer,
  type RawProposal,
  type Rejected,
  type Signal,
  type SiteReading,
  type Compare,
  type Validate,
} from './types.js';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/** Checks the structure of the answer; the schema should already guarantee it. */
export function isRawAnswer(value: unknown): value is RawAnswer {
  if (!isObject(value) || !Array.isArray(value.proposals) || !Array.isArray(value.signals)) {
    return false;
  }
  const proposalOk = (p: unknown) =>
    isObject(p) &&
    oneOf(FIELDS, p.field) &&
    (p.network === 'none' || oneOf(NETWORKS, p.network)) &&
    isString(p.value) &&
    isString(p.quote) &&
    isString(p.source_url);
  const signalOk = (s: unknown) => isObject(s) && oneOf(SIGNAL_KINDS, s.kind) && isString(s.quote) && isString(s.source_url);
  return value.proposals.every(proposalOk) && value.signals.every(signalOk);
}

/** Other spellings of a key, e.g. X for Twitter. */
const ALIASES: Partial<Record<string, string[]>> = { twitter: ['twitter', 'x'] };

/**
 * The key for a suggestion in the form the element already uses: an existing
 * `contact:<name>`, else an existing `<name>`, else `contact:<name>`. The
 * website stays `website` if it is new, opening hours are always
 * `opening_hours`.
 */
export function targetKey(base: string, tags: Record<string, string>): string {
  if (base === 'opening_hours') {
    return base;
  }
  const names = ALIASES[base] ?? [base];
  const existing =
    names.map((name) => `contact:${name}`).find((key) => tags[key] !== undefined) ?? names.find((name) => tags[name] !== undefined);
  if (existing !== undefined) {
    return existing;
  }
  return base === 'website' ? 'website' : `contact:${base}`;
}

function baseKey(raw: RawProposal): string | undefined {
  if (raw.field === 'social') {
    return raw.network === 'none' ? undefined : raw.network;
  }
  return raw.field;
}

/** Values separated by `;`, as a set, so the order does not count. */
function sameValues(a: string, b: string): boolean {
  const parts = (value: string) =>
    value
      .split(';')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== '')
      .sort()
      .join(';');
  return parts(a) === parts(b);
}

const LINK_FIELDS = new Set<Field>(['email', 'website', 'social']);

/**
 * Whether the quote is on the page: as it is, or without the link addresses
 * the text of a saved page has after each link ("03677 8468-0 (tel:…)"),
 * which a quote of the visible text does not contain.
 */
function quoteOnPage(page: string, quote: string): boolean {
  return (
    containsQuote(page, quote) ||
    containsQuote(page.replace(/ \((?:https?:\/\/|mailto:|tel:)[^)\s]*\)/gi, ''), quote)
  );
}

/** Hosts of platforms, never part of a business's own website. */
const PLATFORMS = [
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'xing.com', 'youtube.com',
  'youtu.be', 'tiktok.com', 'pinterest.com', 'pinterest.de', 'vimeo.com', 'flickr.com', 'vk.com', 't.me', 'wa.me',
  'whatsapp.com', 'mastodon.social', 'bsky.app', 'google.com', 'google.de', 'goo.gl', 'apple.com', 'bing.com',
  'tripadvisor.com', 'tripadvisor.de', 'yelp.com', 'yelp.de', 'wikipedia.org', 'wikimedia.org', 'openstreetmap.org',
  'sedo.com',
];

/**
 * The hosts of the website: the one from the OSM tag, and those its own pages
 * link to (e.g. a new domain the old start page links to). Platforms do not
 * count.
 */
function siteHosts(host: string, pages: Map<string, string>): string[] {
  const hosts = new Set([host]);
  for (const [url, text] of pages) {
    if (!onSite(url, host)) {
      continue;
    }
    for (const [link] of text.matchAll(/https?:\/\/[^\s()"'<>]+/gi)) {
      const linked = siteHost(link);
      if (linked !== undefined && !PLATFORMS.some((platform) => onSite(link, platform))) {
        hosts.add(linked);
      }
    }
  }
  return [...hosts];
}

/**
 * Turns the answer into suggestions. A suggestion is rejected if its quote is
 * not on a fetched page of the site, if a link or address is not on the page,
 * if the value is invalid, or if it is the current value.
 */
export function checkAnswer(
  answer: RawAnswer,
  pages: Map<string, string>,
  request: AssistRequest,
  validate: Validate = (_key, value) => ({ valid: true, value }),
  compare?: Compare,
): { proposals: Proposal[]; signals: Signal[]; rejected: Rejected[] } {
  const host = siteHost(request.url) ?? '';
  const hosts = siteHosts(host, pages);
  const onWebsite = (url: string) => hosts.some((h) => onSite(url, h));
  const tags = request.element.tags;
  const text = (url: string) => pages.get(url) ?? [...pages.values()].join('\n');
  const proposals: Proposal[] = [];
  const rejected: Rejected[] = [];
  const reject = (proposal: Proposal, reason: Rejected['reason'], message: string) =>
    rejected.push({ proposal, reason, message });

  for (const raw of answer.proposals) {
    const base = baseKey(raw);
    const key = base === undefined ? raw.field : targetKey(base, tags);
    const oldValue = tags[key];
    const proposal: Proposal = {
      key,
      value: raw.value.trim(),
      ...(oldValue === undefined ? {} : { oldValue }),
      quote: raw.quote,
      sourceUrl: raw.source_url,
    };
    if (base === undefined) {
      reject(proposal, 'unknown_key', 'No social network given');
      continue;
    }
    if (!onWebsite(raw.source_url)) {
      reject(proposal, 'foreign_source', `Source is not on ${host}`);
      continue;
    }
    const page = text(raw.source_url);
    if (!quoteOnPage(page, raw.quote)) {
      reject(proposal, 'quote_not_found', 'Quote not found on the page');
      continue;
    }
    if (LINK_FIELDS.has(raw.field) && !page.toLowerCase().includes(bareUrl(raw.value.replace(/^mailto:/i, '')))) {
      reject(proposal, 'quote_not_found', 'Link or address not found on the page');
      continue;
    }
    const checked = validate(key, proposal.value);
    if (!checked.valid) {
      reject(proposal, 'invalid', checked.message ?? 'Invalid value');
      continue;
    }
    proposal.value = checked.value;
    if (
      oldValue !== undefined &&
      (sameValues(validate(key, oldValue).value, proposal.value) || compare?.(key, oldValue, proposal.value) === true)
    ) {
      reject(proposal, 'unchanged', 'Value unchanged');
      continue;
    }
    // the model may name one value twice (e.g. from two pages)
    if (!proposals.some((p) => p.key === proposal.key && sameValues(p.value, proposal.value))) {
      proposals.push(proposal);
    }
  }

  const signals = answer.signals
    .filter((raw) => onWebsite(raw.source_url) && quoteOnPage(text(raw.source_url), raw.quote))
    .map((raw) => ({ kind: raw.kind, quote: raw.quote, sourceUrl: raw.source_url }));
  return { proposals, signals, rejected };
}

/** Compares what was read on the website with the tags of one element. Costs nothing. */
export function assess(reading: SiteReading, request: AssistRequest, validate?: Validate, compare?: Compare): AssistResult {
  const checked = checkAnswer(reading.answer, new Map(Object.entries(reading.texts)), request, validate, compare);
  return { ...checked, pages: reading.pages, model: reading.model, usage: reading.usage };
}
