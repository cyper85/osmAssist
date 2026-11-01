import type { ModelInfo } from './types.js';

/** List prices in USD per million tokens (input, output), as of 2026-11. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-4-5': [1, 5],
};

/** Models offered in the settings; the first one is the default. */
export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'] as const;

/** e.g. claude-sonnet-5-5 → Claude Sonnet 5.5, claude-haiku-4-5-20251001 → Claude Haiku 4.5 */
export function claudeModel(id: string): ModelInfo {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  const name =
    match === null
      ? id
      : `Claude ${match[1]!.charAt(0).toUpperCase()}${match[1]!.slice(1)} ${match[2]}${match[3] === undefined ? '' : `.${match[3]}`}`;
  return { vendor: 'Anthropic', name, id };
}

export function estimateCost(id: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = PRICES[id.replace(/-\d{8}$/, '')];
  return price === undefined ? undefined : (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

/** The value for the changeset tag ai_assisted, e.g. "Anthropic Claude Sonnet 5.5". */
export function aiAssistedTag(models: ModelInfo[]): string {
  return [...new Set(models.map((model) => `${model.vendor} ${model.name}`))].join(';');
}
