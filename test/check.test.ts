import { describe, expect, it } from 'vitest';
import { checkAnswer, isMobileNumber, isRawAnswer, separateMobile, targetKey } from '../src/check.js';
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

  // first real run (2026-11-02): the old domain's start page links to the new one
  it('accepts sources on a domain the site itself links to, but not on platforms', () => {
    const site = new Map([
      ['https://www.sonnenschein.example/', 'Neue Seite (https://sonnenschein-neu.example/kontakt) · Facebook (https://www.facebook.com/x)'],
      ['https://sonnenschein-neu.example/kontakt', PAGE],
      ['https://www.facebook.com/x', 'Öffnungszeiten: Montag bis Freitag 6-18 Uhr'],
    ]);
    const moved = checkAnswer(answer(proposal({ source_url: 'https://sonnenschein-neu.example/kontakt' })), site, request({}));
    expect(moved.proposals).toHaveLength(1);
    const platform = checkAnswer(answer(proposal({ source_url: 'https://www.facebook.com/x' })), site, request({}));
    expect(platform.rejected[0]?.reason).toBe('foreign_source');
  });

  // first real run (2026-11-02): the phone number before the quoted e-mail was a tel: link
  it('finds quotes of the visible text between links', () => {
    const site = new Map([
      ['https://www.sonnenschein.example/kontakt', 'Telefon: 03677 8468-0 (tel:+493677846800) E-Mail: info@sonnenschein.example (mailto:info@sonnenschein.example)'],
    ]);
    const mail = proposal({ field: 'email', value: 'info@sonnenschein.example', quote: 'Telefon: 03677 8468-0 E-Mail: info@sonnenschein.example' });
    expect(checkAnswer(answer(mail), site, request({})).proposals).toHaveLength(1);
  });

  it('drops values that only differ in spelling, by the compare of the caller', () => {
    const compare = (_key: string, a: string, b: string) => a.replace(/; Su,PH off$/, '') === b;
    const hours = request({ opening_hours: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00; Su,PH off' });
    const result = checkAnswer(answer(proposal({})), pages, hours, undefined, compare);
    expect(result.proposals).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('unchanged');
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

describe('mobile numbers', () => {
  const CONTACT = `Bäckerei Sonnenschein
Telefon: 03677 123456 · Mobil: 0171 2345678
WhatsApp: 0151 98765432 · oder schreiben Sie uns: https://wa.me/message/ABCDEF123
Fax: 03677 123457`;
  const contact = new Map([['https://www.sonnenschein.example/kontakt', CONTACT]]);
  const phone = (value: string, quote = 'Telefon: 03677 123456 · Mobil: 0171 2345678') => proposal({ field: 'phone', value, quote });

  it('knows mobile numbers in Germany, Austria and Switzerland', () => {
    expect(isMobileNumber('+49 171 2345678')).toBe(true);
    expect(isMobileNumber('+43 664 1234567')).toBe(true);
    expect(isMobileNumber('+41 79 1234567')).toBe(true);
    expect(isMobileNumber('+49 3677 123456')).toBe(false);
    expect(isMobileNumber('+41 44 1234567')).toBe(false);
    expect(isMobileNumber('0171 2345678')).toBe(false);
  });

  it('moves mobile numbers reported as phone to mobile', () => {
    expect(separateMobile([phone('+49 3677 123456; +49 171 2345678')])).toEqual([
      phone('+49 3677 123456'),
      { ...phone('+49 171 2345678'), field: 'mobile' },
    ]);
    // only a mobile number: no phone suggestion left
    expect(separateMobile([phone('+49 171 2345678')]).map((p) => p.field)).toEqual(['mobile']);
    // the same number from the model and moved here counts once
    expect(separateMobile([phone('+49 171 2345678'), { ...phone('+49 171 2345678'), field: 'mobile' }])).toEqual([
      { ...phone('+49 171 2345678'), field: 'mobile' },
    ]);
  });

  it('suggests contact:mobile, or mobile if the element uses phone', () => {
    const result = checkAnswer(answer(phone('+49 3677 123456; +49 171 2345678')), contact, request({}));
    expect(result.proposals.map((p) => `${p.key}=${p.value}`)).toEqual(['contact:phone=+49 3677 123456', 'contact:mobile=+49 171 2345678']);
    expect(targetKey('mobile', { phone: '+49 1' })).toBe('mobile');
    expect(targetKey('mobile', { 'contact:phone': '+49 1' })).toBe('contact:mobile');
  });

  it('links the phone suggestion to the mobile one if it drops the number', () => {
    const result = checkAnswer(
      answer(phone('+49 3677 123456; +49 171 2345678')),
      contact,
      request({ 'contact:phone': '+49 3677 123456; +49 171 2345678' }),
    );
    expect(result.proposals).toMatchObject([
      { key: 'contact:phone', value: '+49 3677 123456', together: { key: 'contact:mobile', value: '+49 171 2345678' } },
      { key: 'contact:mobile', value: '+49 171 2345678' },
    ]);
    expect(result.proposals[1]!.together).toBeUndefined();
  });

  it('does not link it if the mobile number is in OSM already', () => {
    const result = checkAnswer(
      answer(phone('+49 3677 123456; +49 171 2345678')),
      contact,
      request({ phone: '+49 3677 123456; +49 171 2345678', mobile: '+49 171 2345678' }),
    );
    expect(result.proposals).toEqual([expect.objectContaining({ key: 'phone', value: '+49 3677 123456' })]);
    expect(result.proposals[0]!.together).toBeUndefined();
  });
});

describe('WhatsApp', () => {
  const CONTACT = `Bäckerei Sonnenschein
Telefon: 03677 123456 · Mobil: 0171 2345678
WhatsApp: 0151 98765432 · oder schreiben Sie uns: https://wa.me/message/ABCDEF123`;
  const contact = new Map([['https://www.sonnenschein.example/kontakt', CONTACT]]);
  const whatsapp = (value: string, quote: string) => proposal({ field: 'social', network: 'whatsapp', value, quote });
  const keys = (raw: RawProposal) =>
    checkAnswer(answer(raw), contact, request({})).proposals.map((p) => `${p.key}=${p.value}`);
  const reasons = (raw: RawProposal) =>
    checkAnswer(answer(raw), contact, request({})).rejected.map((r) => r.message);

  it('takes a number named for WhatsApp', () => {
    expect(keys(whatsapp('+49 151 98765432', 'WhatsApp: 0151 98765432'))).toEqual(['contact:whatsapp=+49 151 98765432']);
  });

  it('takes a WhatsApp link without a number', () => {
    expect(keys(whatsapp('https://wa.me/message/ABCDEF123', 'oder schreiben Sie uns: https://wa.me/message/ABCDEF123'))).toEqual([
      'contact:whatsapp=https://wa.me/message/ABCDEF123',
    ]);
  });

  it('rejects a number that is not named for WhatsApp', () => {
    expect(reasons(whatsapp('+49 171 2345678', 'Mobil: 0171 2345678'))).toEqual(['The quote does not name WhatsApp']);
  });

  it('rejects a number that is not on the page', () => {
    expect(reasons(whatsapp('+49 151 11111111', 'WhatsApp: 0151 98765432'))).toEqual(['Number not found on the page']);
  });
});
