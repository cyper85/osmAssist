# Answer file (`osmcorrection-assist-answer`, version 1)

Schema: [`schema/answer-file.schema.json`](../schema/answer-file.schema.json)
(JSON Schema draft 2020-12, `$id`
`https://raw.githubusercontent.com/cyper85/osmAssist/master/schema/answer-file.schema.json`).
The file is generated from `ANSWER_FILE_SCHEMA` in `src/answerFile.ts`
(`npm run schema`); a test fails if they differ.

## Where it is used

An app can let an **AI agent on the user's computer** analyse the websites
instead of calling an AI API, e.g. Claude Code with the user's Claude plan,
Kiro or Codex CLI. Any agent that can run commands and write files works; a
pure chat does not, because it cannot save the pages.

1. The app writes a job file (`jobFile()`, saved as `auftrag.md`): German
   instructions for the agent, this schema, an example and the list of jobs.
   A job is one website with the OpenStreetMap elements that use it, e.g.
   `a1: node/42, way/4711`.
2. The agent fetches the elements from the OSM API, saves the pages of the
   website unchanged as HTML in `seiten/` (headless browser, or `curl`), and
   writes one answer file per job to `antworten/<job>.json`.
3. The app reads the folder back: `parseAnswerFile()` for each answer,
   `readingFromAnswer()` with the saved pages, then `assess()` for each
   element, with the same checks as for the API (quote on a saved page,
   source on the website, links and e-mail addresses on the page, format
   check, unchanged values dropped).

The pages are saved by a command, not written by the agent, so the quotes
can be checked against what the website really says.

## Fields

| Field | Content |
|---|---|
| `format` | always `"osmcorrection-assist-answer"` |
| `version` | always `1` |
| `ai` | who wrote the answer, see below |
| `job` | ID of the job, e.g. `"a1"` |
| `elements` | the elements of the job, e.g. `["node/42", "way/4711"]` |
| `url` | the website from the OSM data |
| `fetched_with` | `"browser"` (headless Edge/Chrome, with JavaScript) or `"curl"` |
| `pages` | every page fetched: `url` and either `file` (path of the saved HTML, `seiten/<name>.html`) or `error` (e.g. `"HTTP 404"`) |
| `proposals` | values the pages state, as for the API: `field`, `network`, `value`, `quote`, `source_url` |
| `signals` | `kind` (`closed`, `moved`, `parked`, `new_owner`), `quote`, `source_url` |

`proposals` and `signals` have the same entries as the structured output of
the API (`ANSWER_SCHEMA`). The agent reports **everything** the pages state,
whether or not it matches the current tags; the comparison with the tags
happens in `assess()`.

### `ai`

| Field | Content |
|---|---|
| `vendor` | maker of the **model**, not of the tool: `"Anthropic"`, `"OpenAI"`, `"Google"`, … A Claude model in Kiro is `"Anthropic"`. |
| `model` | the model as the agent knows it, e.g. `"claude-opus-5-5"`, else `"unknown"` |
| `tool` | the agent it ran in, e.g. `"Claude Code"`, `"Kiro"`, `"Codex CLI"` |

This is the agent's own statement and cannot be verified. osmCorrection
shows it on import and lets the user confirm or correct vendor and model;
only the confirmed values go into the changeset tag `ai_assisted`, e.g.
`Anthropic Claude Opus 5.5` (the vendor alone if the model is unknown). Pass it to
`readingFromAnswer(answer, pages, vendor)`; without it, the stated vendor is
used.

## Tolerance

`parseAnswerFile()` is a little more lenient than the schema, so that one
slip does not make a whole run useless:

- `signal` or `type` instead of `kind` in a signal (seen in the first real
  run),
- a missing `ai` (answers written before version 1 had it): `answer.ai` is
  then `undefined` and the caller has to ask for the vendor.

Other deviations throw an error that names the entry and field, e.g.
`signals[0]: "kind" must be one of closed, moved, parked, new_owner`.

## Example

```json
{
  "format": "osmcorrection-assist-answer",
  "version": 1,
  "ai": { "vendor": "Anthropic", "model": "claude-opus-5-5", "tool": "Claude Code" },
  "job": "a1",
  "elements": ["node/42"],
  "url": "https://www.beispiel-baeckerei.de/",
  "fetched_with": "browser",
  "pages": [
    { "url": "https://www.beispiel-baeckerei.de/", "file": "seiten/a1-1.html" },
    { "url": "https://www.beispiel-baeckerei.de/zeiten", "error": "HTTP 404" }
  ],
  "proposals": [
    {
      "field": "opening_hours",
      "network": "none",
      "value": "Mo-Fr 06:00-18:00; Sa 06:00-12:00",
      "quote": "Montag bis Freitag 6–18 Uhr, Samstag 6–12 Uhr",
      "source_url": "https://www.beispiel-baeckerei.de/"
    }
  ],
  "signals": []
}
```
