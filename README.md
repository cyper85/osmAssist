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

## Installation

```bash
npm install osmassist
```

ES module with TypeScript types, for Node.js ≥ 22 and browsers (via a
bundler). The Claude provider is a separate entry point
(`osmassist/claude`), so a web app loads the Anthropic SDK only where it is
used. The JSON Schema of the answer files is part of the package
(`osmassist/schema/answer-file.schema.json`).

## Usage

```ts
import { aiAssistedTag } from 'osmassist';
// separate entry point, so a web app can load the SDK only when it is needed
import { createClaudeProvider } from 'osmassist/claude';

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

`analyze` is `read` and `assess` in one step. `read` costs tokens and does
not depend on the current tags: the model reports everything the site says.
`assess(reading, request, validate)` compares it with the tags of one
element and costs nothing, so a reading can be reused for other elements
with the same website (and the same address, if the site lists several
locations):

```ts
import { assess } from 'osmassist';

const reading = await provider.read(request);
assess(reading, request, validate);
assess(reading, { ...request, element: otherElement }, validate);
```

Keys follow the form the feature already uses (`phone` or `contact:phone`);
new contact tags get `contact:*`.

Errors are thrown as `AssistError` with a `code` (`auth`, `rate_limit`,
`refused`, `incomplete`, `invalid_response`, `api`, `aborted`). Messages are
in English; callers translate them by code.

## Analysis by an AI agent (e.g. Claude Code)

To use an AI plan instead of API credits, the analysis can run in an AI
agent on the user's computer, e.g. Claude Code with a Claude plan, Kiro or
Codex CLI: `jobFile` writes the instructions with the element IDs
(`auftrag.md`), the agent saves the pages (headless browser or `curl`) and
writes one answer file per job, and the app reads them back:

```ts
import { assess, parseAnswerFile, readingFromAnswer } from 'osmassist';

const answer = parseAnswerFile(json);                       // antworten/a1.json
answer.ai;                                                  // { vendor, model, tool }, as the agent states it
const reading = readingFromAnswer(answer, pages, vendor);   // pages: path → saved HTML; vendor: confirmed by the user
assess(reading, { element, url: answer.url, today }, validate);
```

The format of the answer files is described in
[docs/answer-file.md](docs/answer-file.md), with the JSON Schema in
[schema/answer-file.schema.json](schema/answer-file.schema.json) (also
exported as `ANSWER_FILE_SCHEMA` and as the package file
`osmassist/schema/answer-file.schema.json`).

`htmlToText` turns the saved HTML into text without a DOM; links keep their
address, so profile links and e-mail addresses can be checked. `decodeHtml`
reads saved files in UTF-8, UTF-16 or the charset the page declares.

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
npm run schema  # schema/answer-file.schema.json from the code
```

Releases: a GitHub release with a tag like `v1.0.0-alpha.1` (matching `version` in
`package.json`) publishes the package to npm (`.github/workflows/publish.yaml`,
npm trusted publishing, no token). Versions with a suffix such as
`1.0.0-alpha.1` get the npm tag `next`, others `latest`.

## License

MIT
