# osmAssist

Suggests [OpenStreetMap](https://www.openstreetmap.org) tag changes from a
feature's own website with the help of an AI model: opening hours, phone and
fax numbers, e-mail addresses, a new website address and linked profiles on
social networks, plus signals that the business has closed, moved, or that
the domain is parked or belongs to someone else.

The library only makes suggestions. Every suggestion comes with a verbatim
quote and the page it is from, and must be checked and approved by a human
before anything is changed in OpenStreetMap. It is used by
[osmCorrection](https://github.com/cyper85/osmCorrection).

## Principles

- **One feature at a time, on request.** No bulk edits.
- **The user's own API key.** The caller pays for the tokens.
- **Only the feature's website** (the domain from the OSM tag) is fetched.
  Closed or paid networks (Facebook, Instagram, Google …) are never fetched;
  links to profiles are taken from the website only.
- **No knowledge of the model.** A suggestion is rejected unless its quote is
  found on a fetched page of the site; links and e-mail addresses must
  appear on the page as well.

## Usage

```ts
import { createClaudeProvider, aiAssistedTag } from 'osmassist';

const provider = createClaudeProvider({ apiKey: userKey }); // Claude Sonnet 5.5 by default

const result = await provider.analyze(
  {
    element: { type: 'node', id: 123, tags: { shop: 'bakery', website: 'https://example.org/' } },
    url: 'https://example.org/',
    today: '2026-11-01',
    country: 'DE',
  },
  {
    // format check of the caller, e.g. with osmValidation; returns the preferred form
    validate: (key, value) => ({ valid: true, value }),
  },
);

result.proposals; // [{ key: 'opening_hours', value: 'Mo-Fr 06:00-18:00', oldValue?, quote, sourceUrl }]
result.signals;   // [{ kind: 'closed' | 'moved' | 'parked' | 'new_owner', quote, sourceUrl }]
result.rejected;  // suggestions that failed a check, with reason
result.pages;     // fetched pages, with an error code where fetching failed
result.usage;     // tokens and estimated cost in USD
aiAssistedTag([result.model]); // 'Anthropic Claude Sonnet 5.5', for the changeset
```

Keys follow the form the feature already uses (`phone` or `contact:phone`);
new contact tags get `contact:*`.

Errors are thrown as `AssistError` with a `code` (`auth`, `rate_limit`,
`refused`, `incomplete`, `invalid_response`, `api`, `aborted`). Messages are
in English; callers translate them by code.

## Claude

- Web fetch tool (`web_fetch_20250910`) restricted to the site's domain, at
  most 4 pages of at most 20,000 tokens each. Anthropic fetches the pages, so
  the library also works in the browser without a proxy.
- Structured output with a fixed JSON schema (`ANSWER_SCHEMA`).
- Server-side fallback on refusals (`fallbacks: "default"`); the model that
  actually answered is reported in `result.model`.
- Calls from the browser are enabled (`dangerouslyAllowBrowser`): the key is
  the user's own and only goes to `api.anthropic.com`. Recommend a key with a
  short expiry that is used for nothing else.

## Development

```bash
npm install
npm test        # vitest, with recorded API responses (no real API calls)
npm run build   # dist/
```

## License

MIT
