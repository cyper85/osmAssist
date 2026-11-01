/** What the model may suggest. */
export const FIELDS = ['opening_hours', 'phone', 'fax', 'email', 'website', 'social'] as const;
export type Field = (typeof FIELDS)[number];

/** Social networks and messengers, as in osmValidation (`contact:<network>`). */
export const NETWORKS = [
  'facebook',
  'twitter',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'xing',
  'pinterest',
  'vimeo',
  'flickr',
  'vk',
  'mastodon',
  'bluesky',
  'mobilizon',
  'diaspora',
  'gnusocial',
  'telegram',
  'whatsapp',
  'matrix',
  'tripadvisor',
] as const;
export type Network = (typeof NETWORKS)[number];

export const SIGNAL_KINDS = ['closed', 'moved', 'parked', 'new_owner'] as const;
/**
 * closed: the business has closed for good; moved: it is at a new address;
 * parked: the domain is for sale, parked or a placeholder; new_owner: the
 * domain now belongs to someone else.
 */
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export interface AssistElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
}

export interface AssistRequest {
  element: AssistElement;
  /** the website from the OSM tag */
  url: string;
  /** what to look for; default: all fields */
  fields?: Field[];
  /** YYYY-MM-DD, for relative statements like „ab nächster Woche“ */
  today: string;
  /** ISO 3166-1 alpha-2, for phone numbers */
  country?: string;
}

/** Result of the caller's format check, e.g. with osmValidation. */
export interface ValueCheck {
  valid: boolean;
  /** the value in its preferred form */
  value: string;
  message?: string;
}

/** Checks a value for a key; without it, every value counts as valid as it is. */
export type Validate = (key: string, value: string) => ValueCheck;

export interface AnalyzeOptions {
  signal?: AbortSignal;
  validate?: Validate;
}

export interface Proposal {
  /** the OSM key, e.g. 'opening_hours', 'contact:phone', 'contact:linkedin' */
  key: string;
  value: string;
  /** the current value, undefined if the tag is new */
  oldValue?: string;
  /** verbatim from the page */
  quote: string;
  sourceUrl: string;
}

export interface Signal {
  kind: SignalKind;
  quote: string;
  sourceUrl: string;
}

export type RejectReason = 'unchanged' | 'invalid' | 'quote_not_found' | 'foreign_source' | 'unknown_key';

export interface Rejected {
  proposal: Proposal;
  reason: RejectReason;
  message: string;
}

export interface FetchedPage {
  url: string;
  /** set if the page could not be fetched, e.g. 'url_not_allowed' (robots.txt) */
  error?: string;
}

export interface ModelInfo {
  vendor: string;
  /** e.g. 'Claude Sonnet 5.5' */
  name: string;
  /** e.g. 'claude-sonnet-5-5' */
  id: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** estimate from the list prices, undefined for an unknown model */
  costUsd?: number;
}

export interface AssistResult {
  proposals: Proposal[];
  signals: Signal[];
  rejected: Rejected[];
  pages: FetchedPage[];
  /** the model that answered (with a fallback, not necessarily the requested one) */
  model: ModelInfo;
  usage: Usage;
}

export interface Provider {
  id: string;
  label: string;
  analyze(request: AssistRequest, options?: AnalyzeOptions): Promise<AssistResult>;
}

export type AssistErrorCode = 'auth' | 'rate_limit' | 'refused' | 'incomplete' | 'invalid_response' | 'api' | 'aborted';

export class AssistError extends Error {
  constructor(
    readonly code: AssistErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssistError';
  }
}
