import Anthropic from '@anthropic-ai/sdk';
import { assess, isRawAnswer } from './check.js';
import { claudeModel, CLAUDE_MODELS, estimateCost } from './models.js';
import { ANSWER_SCHEMA, SYSTEM_PROMPT, userMessage } from './prompt.js';
import { siteHost } from './text.js';
import {
  AssistError,
  type AnalyzeOptions,
  type AssistRequest,
  type AssistResult,
  type FetchedPage,
  type Provider,
  type SiteReading,
} from './types.js';

export interface ClaudeOptions {
  apiKey: string;
  /** default: Claude Sonnet 5.5 */
  model?: string;
  /** pages per analysis, including the start page; default 4 */
  maxPages?: number;
  /** tokens per fetched page; longer pages are cut; default 20000 */
  maxPageTokens?: number;
  /** for tests: replaces the HTTP client */
  fetch?: typeof globalThis.fetch;
}

/** Paused server-side tool loops are resumed at most this often. */
const MAX_CONTINUATIONS = 4;

/**
 * Claude reads the website itself with the web fetch tool (on Anthropic's
 * side, so the browser needs no proxy) and answers in a fixed JSON schema.
 * The basic web fetch version returns the full page text, which is needed to
 * check the quotes.
 */
export function createClaudeProvider(options: ClaudeOptions): Provider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    // the key belongs to the user of the page and only goes to api.anthropic.com
    dangerouslyAllowBrowser: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const model = options.model ?? CLAUDE_MODELS[0];

  async function read(request: AssistRequest, { signal }: { signal?: AbortSignal } = {}): Promise<SiteReading> {
    const host = siteHost(request.url);
    if (host === undefined) {
      throw new AssistError('invalid_response', `Not a valid website: ${request.url}`);
    }
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userMessage(request) }];
    const texts: Record<string, string> = {};
    const fetched: FetchedPage[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; ; round++) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            messages,
            tools: [
              {
                type: 'web_fetch_20250910',
                name: 'web_fetch',
                max_uses: options.maxPages ?? 4,
                allowed_domains: [host],
                max_content_tokens: options.maxPageTokens ?? 20000,
              },
            ],
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
            // on a refusal, the API answers with a suitable other model
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          signal === undefined ? {} : { signal },
        );
      } catch (error) {
        throw toAssistError(error);
      }
      inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
      outputTokens += response.usage.output_tokens;

      for (const block of response.content) {
        if (block.type !== 'web_fetch_tool_result') {
          continue;
        }
        const result = block.content;
        if (result.type === 'web_fetch_tool_result_error') {
          const call = response.content.find((b) => b.type === 'server_tool_use' && b.id === block.tool_use_id);
          const url = call?.type === 'server_tool_use' ? String((call.input as { url?: unknown }).url ?? '') : '';
          fetched.push({ url, error: result.error_code });
        } else {
          const source = result.content.source;
          texts[result.url] = source.type === 'text' ? source.data : '';
          fetched.push({ url: result.url });
        }
      }

      if (response.stop_reason === 'pause_turn' && round < MAX_CONTINUATIONS) {
        // the server resumes the paused tool loop when the turn is sent back
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (response.stop_reason === 'refusal') {
        throw new AssistError('refused', 'The model declined the request.');
      }
      if (response.stop_reason !== 'end_turn') {
        throw new AssistError('incomplete', `Incomplete answer (${response.stop_reason ?? 'unknown'}).`);
      }

      const text = response.content.filter((b) => b.type === 'text').at(-1);
      let answer: unknown;
      try {
        answer = JSON.parse(text?.type === 'text' ? text.text : '');
      } catch {
        throw new AssistError('invalid_response', 'The answer is not valid JSON.');
      }
      if (!isRawAnswer(answer)) {
        throw new AssistError('invalid_response', 'The answer does not match the schema.');
      }
      const costUsd = estimateCost(response.model, inputTokens, outputTokens);
      return {
        url: request.url,
        answer,
        texts,
        pages: fetched,
        model: claudeModel(response.model),
        usage: { inputTokens, outputTokens, ...(costUsd === undefined ? {} : { costUsd }) },
      };
    }
  }

  return {
    id: 'claude',
    label: `Anthropic ${claudeModel(model).name}`,
    read,
    async analyze(request: AssistRequest, { signal, validate, compare }: AnalyzeOptions = {}): Promise<AssistResult> {
      return assess(await read(request, signal === undefined ? {} : { signal }), request, validate, compare);
    },
  };
}

function toAssistError(error: unknown): AssistError {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AssistError('aborted', 'Aborted.');
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AssistError('auth', 'The API key was rejected.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistError('rate_limit', 'Too many requests, try again later.');
  }
  if (error instanceof Anthropic.APIError) {
    return new AssistError('api', `API error: ${error.message}`);
  }
  return new AssistError('api', error instanceof Error ? error.message : String(error));
}
