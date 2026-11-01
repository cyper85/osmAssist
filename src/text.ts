/**
 * Normalizes text for comparing a quote with the page: Unicode forms, case,
 * dashes and quotation marks, markdown markers and whitespace do not count.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[*_#|>`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([:;,.!?])/g, '$1')
    .trim();
}

/** Whether the quote appears in the text, ignoring the differences above. */
export function containsQuote(text: string, quote: string): boolean {
  const needle = normalizeText(quote);
  return needle !== '' && normalizeText(text).includes(needle);
}

/** A URL without scheme, `www.` and trailing slash, for finding it in page text. */
export function bareUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/** The host of a URL without `www.`, undefined if it is not a URL. */
export function siteHost(url: string): string | undefined {
  try {
    const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Whether the URL belongs to the site (same host or a subdomain of it). */
export function onSite(url: string, host: string): boolean {
  const other = siteHost(url);
  return other !== undefined && (other === host || other.endsWith(`.${host}`));
}
