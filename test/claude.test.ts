import { describe, expect, it } from 'vitest';
import { assess } from '../src/check.js';
import { createClaudeProvider } from '../src/claude.js';
import { aiAssistedTag, claudeModel, estimateCost } from '../src/models.js';
import { AssistError, type AssistRequest } from '../src/types.js';

const request: AssistRequest = {
  element: { type: 'node', id: 7, tags: { shop: 'bakery', name: 'Sonnenschein', building: 'yes' } },
  url: 'https://www.sonnenschein.example/',
  today: '2026-11-01',
};

const PAGE = 'Öffnungszeiten: Mo–Fr 6–18 Uhr';

function message(content: unknown[], stopReason = 'end_turn') {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10_000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

const fetchCall = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_fetch', input: { url: request.url } };
const fetchResult = {
  type: 'web_fetch_tool_result',
  tool_use_id: 'srvtoolu_1',
  content: {
    type: 'web_fetch_result',
    url: request.url,
    retrieved_at: '2026-11-01T10:00:00Z',
    content: { type: 'document', title: 'Sonnenschein', citations: null, source: { type: 'text', media_type: 'text/plain', data: PAGE } },
  },
};
const answer = {
  type: 'text',
  text: JSON.stringify({
    proposals: [
      {
        field: 'opening_hours',
        network: 'none',
        value: 'Mo-Fr 06:00-18:00',
        quote: 'Öffnungszeiten: Mo-Fr 6-18 Uhr',
        source_url: request.url,
      },
    ],
    signals: [],
  }),
};

/** A fake HTTP client that answers with the given messages one after the other. */
function fakeApi(...responses: { status?: number; body: unknown }[]) {
  const requests: { headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no more' } } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_1' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

describe('createClaudeProvider', () => {
  it('fetches only the site and returns checked suggestions', async () => {
    const api = fakeApi({ body: message([fetchCall, fetchResult, answer]) });
    const provider = createClaudeProvider({ apiKey: 'sk-test', fetch: api.fetch });
    const result = await provider.analyze(request);

    expect(result.proposals).toMatchObject([{ key: 'opening_hours', value: 'Mo-Fr 06:00-18:00' }]);
    expect(result.pages).toEqual([{ url: request.url }]);
    expect(result.model).toEqual({ vendor: 'Anthropic', name: 'Claude Sonnet 5.5', id: 'claude-sonnet-5-5' });
    expect(result.usage).toEqual({ inputTokens: 10_000, outputTokens: 500, costUsd: 0.025 });

    const [sent] = api.requests;
    expect(sent?.body.model).toBe('claude-sonnet-5-5');
    expect(sent?.body.tools).toEqual([
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 4, allowed_domains: ['sonnenschein.example'], max_content_tokens: 20000 },
    ]);
    expect(sent?.body.fallbacks).toBe('default');
    expect(sent?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(JSON.stringify(sent?.body.messages)).toContain('Website: https://www.sonnenschein.example/');
    expect(JSON.stringify(sent?.body.messages)).not.toContain('building');
  });

  it('reads the site once and assesses it for several elements', async () => {
    const api = fakeApi({ body: message([fetchCall, fetchResult, answer]) });
    const reading = await createClaudeProvider({ apiKey: 'sk-test', fetch: api.fetch }).read(request);
    const withHours = { ...request, element: { ...request.element, tags: { opening_hours: 'Mo-Fr 06:00-18:00' } } };
    expect(assess(reading, request).proposals).toHaveLength(1);
    expect(assess(reading, withHours).proposals).toEqual([]);
    expect(assess(reading, withHours).rejected[0]?.reason).toBe('unchanged');
    expect(api.requests).toHaveLength(1);
  });

  it('resumes a paused turn', async () => {
    const api = fakeApi({ body: message([fetchCall, fetchResult], 'pause_turn') }, { body: message([answer]) });
    const result = await createClaudeProvider({ apiKey: 'sk-test', fetch: api.fetch }).analyze(request);
    expect(result.proposals).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(20_000);
    const messages = api.requests[1]?.body.messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('reports pages that could not be fetched', async () => {
    const failed = {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_allowed' },
    };
    const empty = { type: 'text', text: '{"proposals":[],"signals":[]}' };
    const api = fakeApi({ body: message([fetchCall, failed, empty]) });
    const result = await createClaudeProvider({ apiKey: 'sk-test', fetch: api.fetch }).analyze(request);
    expect(result.pages).toEqual([{ url: request.url, error: 'url_not_allowed' }]);
  });

  it('turns refusals and API errors into AssistError', async () => {
    const refused = fakeApi({ body: message([], 'refusal') });
    await expect(createClaudeProvider({ apiKey: 'sk-test', fetch: refused.fetch }).analyze(request)).rejects.toMatchObject({
      code: 'refused',
    });
    const denied = fakeApi({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    const error = await createClaudeProvider({ apiKey: 'sk-bad', fetch: denied.fetch })
      .analyze(request)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistError);
    expect((error as AssistError).code).toBe('auth');
  });

  it('rejects an answer that is not JSON', async () => {
    const api = fakeApi({ body: message([{ type: 'text', text: 'Leider nichts gefunden.' }]) });
    await expect(createClaudeProvider({ apiKey: 'sk-test', fetch: api.fetch }).analyze(request)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('models', () => {
  it('names the model for the changeset', () => {
    expect(claudeModel('claude-haiku-4-5-20251001').name).toBe('Claude Haiku 4.5');
    expect(claudeModel('claude-opus-5').name).toBe('Claude Opus 5');
    expect(aiAssistedTag([claudeModel('claude-sonnet-5-5'), claudeModel('claude-sonnet-5-5')])).toBe('Anthropic Claude Sonnet 5.5');
    expect(aiAssistedTag([claudeModel('claude-sonnet-5-5'), claudeModel('claude-opus-5-5')])).toBe(
      'Anthropic Claude Sonnet 5.5;Anthropic Claude Opus 5.5',
    );
  });

  it('estimates the cost', () => {
    expect(estimateCost('claude-opus-5-5', 1_000_000, 0)).toBe(4);
    expect(estimateCost('claude-unknown-1', 1, 1)).toBeUndefined();
  });
});
