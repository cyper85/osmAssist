/*
 * Text of a saved web page, for checking quotes. Works without a DOM (browser
 * and Node alike). Links keep their address, so profiles and e-mail addresses
 * can be checked: <a href="https://instagram.com/x">Instagram</a> becomes
 * "Instagram (https://instagram.com/x)".
 */

const DROP = /<(script|style|noscript|template|svg|head|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const BLOCKS =
  /<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|nav|main|aside|address|dl|dt|dd|blockquote|pre|hr|form|label|button)\b[^>]*>/gi;
const LINKS = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
const TAGS = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  shy: '',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  euro: '€',
  copy: '©',
  middot: '·',
  bull: '•',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return ENTITIES[name] ?? entity;
  });
}

/**
 * Text of a saved HTML file: UTF-8, UTF-16 (byte order mark, e.g. from a
 * PowerShell redirect) or the charset the page declares (curl saves pages
 * as they come, e.g. ISO-8859-1).
 */
export function decodeHtml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\ufffd')) {
    return utf8.replace(/^\ufeff/, '');
  }
  const charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(utf8)?.[1];
  try {
    return new TextDecoder(charset ?? 'windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Resolves a link against the page, so relative links get their full address. */
function absolute(href: string, base: string | undefined): string {
  try {
    return base === undefined ? href : new URL(href, base).href;
  } catch {
    return href;
  }
}

export function htmlToText(html: string, baseUrl?: string): string {
  // the head is dropped, but its title stays: parked domains often say it only there
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]?.trim() ?? '';
  return decodeEntities(
    `${title}\n${html}`
      .replace(COMMENTS, ' ')
      .replace(DROP, ' ')
      .replace(LINKS, (_match, double?: string, single?: string, bare?: string, inner = '') => {
        const href = decodeEntities(double ?? single ?? bare ?? '').trim();
        const label = inner.replace(TAGS, ' ').trim();
        if (href === '' || href.startsWith('#') || /^javascript:/i.test(href)) {
          return ` ${label} `;
        }
        const target = /^(mailto|tel):/i.test(href) ? href : absolute(href, baseUrl);
        return ` ${label} (${target}) `;
      })
      .replace(BLOCKS, '\n')
      .replace(TAGS, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}
