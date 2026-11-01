import { describe, expect, it } from 'vitest';
import { checkAnswer, isRawAnswer, targetKey } from '../src/check.js';
import { containsQuote, onSite, siteHost } from '../src/text.js';
import type { AssistRequest, RawAnswer, RawProposal, Validate } from '../src/types.js';

const PAGE = `Bäckerei Sonnenschein – Ihr Bäcker in Ilmenau
Öffnungszeiten: Montag bis Freitag 6–18 Uhr, Samstag 6–12 Uhr
Telefon: 03677 123456 · E-Mail: info@sonnenschein.example
Folgen Sie uns auf **Instagram**: https://www.instagram.com/sonnenschein_ilmenau/`;

const pages = new Map([['https://www.sonnenschein.example/kontakt', PAGE]]);

function request(tags: Record<string, string>): AssistRequest {
  return {
    element: { type: 'node', id: 1, tags },
    url: 'https://www.sonnenschein.example/',
    today: '2026-11-01',
  };
}

function proposal(fields: Partial<RawProposal>): RawProposal {
  return {
    field: 'opening_hours',
    network: 'none',
    value: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00',
    quote: 'Öffnungszeiten: Montag bis Freitag 6-18 Uhr, Samstag 6-12 Uhr',
    source_url: 'https://www.sonnenschein.example/kontakt',
    ...fields,
  };
}

const answer = (...proposals: RawProposal[]): RawAnswer => ({ proposals, signals: [] });

describe('text', () => {
  it('compares quotes without dashes, case, markdown and whitespace', () => {
    expect(containsQuote(PAGE, 'öffnungszeiten:  Montag bis Freitag 6-18 Uhr')).toBe(true);
    expect(containsQuote(PAGE, 'Folgen Sie uns auf Instagram')).toBe(true);
    expect(containsQuote(PAGE, 'Sonntag 8-11 Uhr')).toBe(false);
    expect(containsQuote(PAGE, '   ')).toBe(false);
  });

  it('knows the site', () => {
    expect(siteHost('https://www.Sonnenschein.example/x')).toBe('sonnenschein.example');
    expect(siteHost('sonnenschein.example')).toBe('sonnenschein.example');
    expect(onSite('https://shop.sonnenschein.example/', 'sonnenschein.example')).toBe(true);
    expect(onSite('https://evil-sonnenschein.example/', 'sonnenschein.example')).toBe(false);
  });
});

describe('targetKey', () => {
  it('uses the form the element already has', () => {
    expect(targetKey('phone', { phone: '+49 1' })).toBe('phone');
    expect(targetKey('phone', { 'contact:phone': '+49 1', phone: '+49 2' })).toBe('contact:phone');
    expect(targetKey('twitter', { 'contact:x': 'https://x.com/a' })).toBe('contact:x');
  });

  it('prefers contact:* for new tags, except the website', () => {
    expect(targetKey('instagram', {})).toBe('contact:instagram');
    expect(targetKey('website', {})).toBe('website');
  });
});

describe('checkAnswer', () => {
  it('accepts a suggestion with a quote from the page', () => {
    const { proposals, rejected } = checkAnswer(answer(proposal({})), pages, request({ shop: 'bakery' }));
    expect(rejected).toEqual([]);
    expect(proposals).toEqual([
      {
        key: 'opening_hours',
        value: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00',
        quote: 'Öffnungszeiten: Montag bis Freitag 6-18 Uhr, Samstag 6-12 Uhr',
        sourceUrl: 'https://www.sonnenschein.example/kontakt',
      },
    ]);
  });

  it('rejects an invented quote', () => {
    const { proposals, rejected } = checkAnswer(answer(proposal({ quote: 'Sonntag 8-11 Uhr' })), pages, request({}));
    expect(proposals).toEqual([]);
    expect(rejected[0]?.reason).toBe('quote_not_found');
  });

  it('rejects a source from another site', () => {
    const { rejected } = checkAnswer(answer(proposal({ source_url: 'https://maps.example.com/x' })), pages, request({}));
    expect(rejected[0]?.reason).toBe('foreign_source');
  });

  it('rejects a link that is not on the page', () => {
    const social = proposal({
      field: 'social',
      network: 'instagram',
      value: 'https://www.instagram.com/someone_else/',
      quote: 'Folgen Sie uns auf Instagram',
    });
    expect(checkAnswer(answer(social), pages, request({})).rejected[0]?.message).toMatch(/not found/);
  });

  it('maps a profile to contact:<network>', () => {
    const social = proposal({
      field: 'social',
      network: 'instagram',
      value: 'https://www.instagram.com/sonnenschein_ilmenau/',
      quote: 'Instagram: https://www.instagram.com/sonnenschein_ilmenau/',
    });
    const { proposals } = checkAnswer(answer(social), pages, request({ 'contact:instagram': 'https://instagram.com/old' }));
    expect(proposals[0]).toMatchObject({ key: 'contact:instagram', oldValue: 'https://instagram.com/old' });
  });

  it('uses the preferred form and drops unchanged values', () => {
    const validate: Validate = (key, value) =>
      key.endsWith('phone') ? { valid: true, value: value.replace(/^0/, '+49 ') } : { valid: true, value };
    const phone = proposal({ field: 'phone', value: '03677 123456', quote: 'Telefon: 03677 123456' });
    const changed = checkAnswer(answer(phone), pages, request({ phone: '+49 3677 999' }), validate);
    expect(changed.proposals[0]).toMatchObject({ key: 'phone', value: '+49 3677 123456', oldValue: '+49 3677 999' });
    const same = checkAnswer(answer(phone), pages, request({ phone: '03677 123456' }), validate);
    expect(same.proposals).toEqual([]);
    expect(same.rejected[0]?.reason).toBe('unchanged');
  });

  it('rejects invalid values', () => {
    const validate: Validate = (_key, value) => ({ valid: false, value, message: 'Format falsch' });
    const { rejected } = checkAnswer(answer(proposal({})), pages, request({}), validate);
    expect(rejected[0]).toMatchObject({ reason: 'invalid', message: 'Format falsch' });
  });

  it('keeps signals only with a quote from the site', () => {
    const result = checkAnswer(
      {
        proposals: [],
        signals: [
          { kind: 'closed', quote: 'Ihr Bäcker in Ilmenau', source_url: 'https://www.sonnenschein.example/kontakt' },
          { kind: 'parked', quote: 'Diese Domain steht zum Verkauf', source_url: 'https://www.sonnenschein.example/' },
        ],
      },
      pages,
      request({}),
    );
    expect(result.signals.map((s) => s.kind)).toEqual(['closed']);
  });
});

describe('isRawAnswer', () => {
  it('checks the structure', () => {
    expect(isRawAnswer({ proposals: [proposal({})], signals: [] })).toBe(true);
    expect(isRawAnswer({ proposals: [{ ...proposal({}), field: 'name' }], signals: [] })).toBe(false);
    expect(isRawAnswer({ proposals: [] })).toBe(false);
  });
});
