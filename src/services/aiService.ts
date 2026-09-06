import type { AIModel, AppSettings, Attachment, Message } from '../types';
import { AUTO_MODEL_ID, DEFAULT_MODELS, LEGACY_MODEL_ALIASES } from '../config/constants';

export interface StreamCallbacks {
  /** Called with the full accumulated text so far (not just the newest delta). */
  onChunk: (text: string) => void;
  onFinish: (fullText: string) => void;
  onError: (error: Error) => void;
  /**
   * Emitted when failover means a different model answered than the one shown
   * in the selector. Not called for the first attempt.
   */
  onModelUsed?: (modelId: string) => void;
}

export interface SendOptions {
  /** Aborting this signal cancels the request and the stream reader. */
  signal?: AbortSignal;
  /** Full model catalog, used to decide which models accept images. */
  knownModels?: AIModel[];
}

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'offline';

export interface Route {
  provider: ProviderId;
  /** Upstream model slug forwarded verbatim to the provider. */
  model: string;
  requiresKey: boolean;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Attached documents are inlined as text. Capped so one large PDF cannot blow
 * the context window and get the whole request rejected.
 */
export const MAX_ATTACHMENT_TEXT_CHARS = 24_000;

/**
 * Images stay in the history sent with every follow-up, so a long conversation
 * accumulates them and can blow the provider's per-request cap. Keep the most
 * recent ones and silently drop the oldest past this limit.
 */
export const MAX_IMAGE_PARTS_PER_REQUEST = 10;

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
  offline: 'offline demo',
};

const PROVIDER_KEY_URL: Record<Exclude<ProviderId, 'offline'>, string> = {
  openrouter: 'https://openrouter.ai/keys',
  groq: 'https://console.groq.com/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
};

/** HTTP statuses worth retrying against a different model. */
const RETRYABLE_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);

/**
 * Older builds stored short ids like `groq/llama-3.3-70b`. Translate them so a
 * returning user's saved settings keep working.
 */
export function normalizeModelId(modelId: string): string {
  return LEGACY_MODEL_ALIASES[modelId] ?? modelId;
}

/**
 * Resolve an app-level model id into a concrete provider + upstream slug.
 * Returns null when the id cannot be routed, which callers must surface as an
 * error rather than silently substituting something else.
 */
export function resolveRoute(rawModelId: string): Route | null {
  const modelId = normalizeModelId(rawModelId);

  if (modelId.startsWith('offline/')) {
    return { provider: 'offline', model: modelId.slice('offline/'.length), requiresKey: false };
  }

  if (modelId.startsWith('openrouter/')) {
    const model = modelId.slice('openrouter/'.length);
    if (!model.includes('/')) return null;
    return { provider: 'openrouter', model, requiresKey: true };
  }

  if (modelId.startsWith('groq/')) {
    const model = modelId.slice('groq/'.length);
    if (!model.includes('/')) return null;
    return { provider: 'groq', model, requiresKey: true };
  }

  // Gemini slugs have no org prefix (`gemini-2.5-flash`), so the id itself is
  // the whole slug after the provider segment.
  if (modelId.startsWith('gemini/')) {
    const model = modelId.slice('gemini/'.length);
    if (!model) return null;
    return { provider: 'gemini', model, requiresKey: true };
  }

  return null;
}

function providerOf(modelId: string): ProviderId | null {
  return resolveRoute(modelId)?.provider ?? null;
}

function keyFor(provider: ProviderId, settings: AppSettings): string | undefined {
  switch (provider) {
    case 'groq':
      return settings.groqApiKey?.trim() || undefined;
    case 'gemini':
      return settings.geminiApiKey?.trim() || undefined;
    case 'openrouter':
      return settings.openRouterApiKey?.trim() || undefined;
    default:
      return undefined;
  }
}

/** A configured proxy supplies keys server-side, so no client key is needed. */
export function hasProxy(settings: AppSettings): boolean {
  return Boolean(settings.proxyUrl?.trim());
}

function hasKeyFor(provider: ProviderId, settings: AppSettings): boolean {
  if (provider === 'offline') return true;
  return hasProxy(settings) || Boolean(keyFor(provider, settings));
}

/** Models that only accept `max_completion_tokens` (OpenAI reasoning-style APIs). */
function usesCompletionTokenLimit(model: string): boolean {
  return /(^|\/)gpt-oss-/.test(model);
}

function getReferer(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) return undefined;
  return window.location.origin;
}

/**
 * Build the ordered list of model ids to try.
 *
 * For a specific model this is just that model. For the `auto/best-free`
 * sentinel it is every free model the user actually has a key for, ordered so
 * the largest free quotas are consumed first: Groq caps its free tier per
 * model (~1,000 requests/day each), so spreading across several Groq models
 * and then falling over to OpenRouter multiplies the usable daily volume far
 * beyond any single model's allowance.
 */
export function buildModelChain(
  requestedModelId: string,
  settings: AppSettings,
  options: { knownModels?: AIModel[]; preferVision?: boolean } = {}
): string[] {
  const { knownModels = DEFAULT_MODELS, preferVision = false } = options;
  const requested = normalizeModelId(requestedModelId);

  if (requested !== AUTO_MODEL_ID) return [requested];

  const usable = knownModels
    .map((m) => m.id)
    .filter((id) => id !== AUTO_MODEL_ID)
    .filter((id) => !id.startsWith('offline/'))
    .filter((id) => {
      const provider = providerOf(id);
      return provider !== null && hasKeyFor(provider, settings);
    });

  if (!preferVision) return usable;

  const vision = usable.filter((id) => knownModels.find((m) => m.id === id)?.supportsImages);
  // Vision-capable first, then everything else as a text-only last resort.
  return [...vision, ...usable.filter((id) => !vision.includes(id))];
}

export class ApiError extends Error {
  readonly status: number;
  readonly provider: ProviderId;
  readonly hint?: string;

  constructor(message: string, status: number, provider: ProviderId, hint?: string) {
    super(hint ? `${message}\n\n${hint}` : message);
    this.name = 'ApiError';
    this.status = status;
    this.provider = provider;
    this.hint = hint;
  }
}

function hintForStatus(status: number, provider: ProviderId, model: string): string | undefined {
  if (provider === 'offline') return undefined;
  const keyUrl = PROVIDER_KEY_URL[provider];

  switch (status) {
    case 401:
    case 403:
      return `${PROVIDER_LABEL[provider]} rejected the API key. Open Settings and paste a valid key from ${keyUrl}.`;
    case 402:
      return `${PROVIDER_LABEL[provider]} says this account has no credit for that model. Pick a \`:free\` model or add credit.`;
    case 404:
      return `${PROVIDER_LABEL[provider]} has no model named "${model}". Provider catalogs rotate — refresh the model list in the selector and pick another.`;
    case 429:
      return `Free-tier rate limit reached on ${PROVIDER_LABEL[provider]}. Wait a minute and retry, or switch model.`;
    case 502:
    case 503:
      return `${PROVIDER_LABEL[provider]} is temporarily unavailable. Try again shortly or switch model.`;
    default:
      return undefined;
  }
}

async function extractErrorMessage(response: Response, provider: ProviderId): Promise<string> {
  const body = await response.text().catch(() => '');
  if (body) {
    try {
      const parsed = JSON.parse(body);
      const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      if (body.trim() && !body.trim().startsWith('<')) {
        return body.slice(0, 300);
      }
    }
  }
  return `${PROVIDER_LABEL[provider]} request failed with HTTP ${response.status}.`;
}

/* ---------- attachments ---------- */

/** Fold attached document text into the prompt, within a character budget. */
export function inlineDocumentText(content: string, attachments: Attachment[]): string {
  const docs = attachments.filter((a) => a.kind === 'document');
  if (docs.length === 0) return content;

  let budget = MAX_ATTACHMENT_TEXT_CHARS;
  const blocks: string[] = [];

  for (const doc of docs) {
    const body = doc.error ? `[Could not read this file: ${doc.error}]` : doc.text ?? '';
    if (!body) continue;
    const truncated = body.length > budget;
    const slice = body.slice(0, budget);
    budget -= slice.length;
    blocks.push(
      `--- Attached file: ${doc.name} ---\n${slice}${truncated ? '\n[truncated]' : ''}`
    );
    if (budget <= 0) break;
  }

  if (blocks.length === 0) return content;
  return `${content}\n\n${blocks.join('\n\n')}`;
}

export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type ContentPart = TextPart | ImagePart;

/**
 * Build the `content` field for one message: a plain string when there is
 * nothing to attach, or an OpenAI-style parts array when images are present
 * and the target model accepts them.
 */
export function buildMessageContent(
  message: Message,
  supportsImages: boolean
): string | ContentPart[] {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return message.content;

  const text = inlineDocumentText(message.content, attachments);
  const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl);

  if (images.length === 0 || !supportsImages) return text;

  return [
    { type: 'text', text },
    ...images.map<ImagePart>((a) => ({
      type: 'image_url',
      image_url: { url: a.dataUrl as string },
    })),
  ];
}

/** Drop the oldest image attachments once the request would carry too many. */
export function pruneOldImages(
  messages: Message[],
  maxImageParts: number = MAX_IMAGE_PARTS_PER_REQUEST
): Message[] {
  let budget = maxImageParts;
  const keep = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    for (const a of messages[i].attachments ?? []) {
      if (a.kind !== 'image' || !a.dataUrl) continue;
      if (budget > 0) {
        keep.add(a.id);
        budget--;
      }
    }
  }

  return messages.map((m) => {
    const atts = m.attachments;
    if (!atts || atts.length === 0) return m;
    const filtered = atts.filter((a) => a.kind !== 'image' || keep.has(a.id));
    return filtered.length === atts.length ? m : { ...m, attachments: filtered };
  });
}

export function messageHasImages(message: Message): boolean {
  return (message.attachments ?? []).some((a) => a.kind === 'image' && Boolean(a.dataUrl));
}

/* ---------- Gemini request shape ---------- */

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/** Split `data:image/png;base64,AAAA` into its mime type and raw base64. */
export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1] || 'application/octet-stream', data: match[3] };
}

/** Build the `parts` array for one message in Gemini's native format. */
export function buildGeminiParts(message: Message, supportsImages: boolean): GeminiPart[] {
  const attachments = message.attachments ?? [];
  const text = attachments.length > 0 ? inlineDocumentText(message.content, attachments) : message.content;

  const parts: GeminiPart[] = [];
  if (text) parts.push({ text });

  if (supportsImages) {
    for (const a of attachments) {
      if (a.kind !== 'image' || !a.dataUrl) continue;
      const split = splitDataUrl(a.dataUrl);
      if (split) parts.push({ inline_data: { mime_type: split.mimeType, data: split.data } });
    }
  }

  return parts;
}

/**
 * Assemble a `streamGenerateContent` body. Gemini takes the system prompt in a
 * separate `systemInstruction` field and labels assistant turns `model`.
 */
export function buildGeminiPayload(
  messages: Message[],
  systemPrompt: string,
  settings: AppSettings,
  supportsImages: boolean
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: buildGeminiParts(m, supportsImages),
      })),
    generationConfig: {
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    },
  };
}

function geminiStreamUrl(model: string): string {
  return `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}

/* ---------- live catalog ---------- */

/**
 * Pull the live `:free` catalog from OpenRouter so the selector does not depend
 * on this repo being updated every time the roster rotates.
 */
export async function fetchOpenRouterFreeModels(signal?: AbortSignal): Promise<AIModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, { signal });
  if (!response.ok) {
    throw new Error(`OpenRouter model list returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      description?: string;
      architecture?: { input_modalities?: string[] };
    }>;
  };

  const models = (payload.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.id.endsWith(':free'))
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .slice(0, 12)
    .map<AIModel>((m) => {
      const contextLabel = m.context_length
        ? ` · ${m.context_length >= 1000 ? `${Math.round(m.context_length / 1000)}K` : m.context_length} ctx`
        : '';
      const seesImages = m.architecture?.input_modalities?.includes('image') ?? false;
      return {
        id: `openrouter/${m.id}`,
        name: m.name ?? m.id,
        provider: 'OpenRouter',
        description: (m.description ?? '').slice(0, 140) || 'Free model from the live OpenRouter catalog.',
        badge: `Free${seesImages ? ' · Vision' : ''}${contextLabel}`,
        isFreeByDefault: true,
        requiresKey: true,
        speed: 'Fast',
        supportsImages: seesImages,
        fromLiveCatalog: true,
      };
    });

  return models;
}

/* ---------- offline demo ---------- */

/**
 * Canned rule-based replies used only for the explicitly-selected offline demo
 * mode. This is not a language model and never pretends to be one.
 */
function scriptedDemoResponse(messages: Message[]): string {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content.toLowerCase() ?? '';

  const banner =
    '> **Scripted Offline Demo** — this reply was produced by a hard-coded ' +
    'rule in this app, not by a language model. Switch the model selector to a ' +
    'real model and add a free API key in Settings to get actual AI answers.\n\n';

  if (/hello|hi\b|hey/.test(lastUserMsg)) {
    return `${banner}Hello! The UI is wired up and working. To talk to a real model, pick one from the selector and add a key in Settings.`;
  }

  if (/\bcode|python|javascript|react|html\b/.test(lastUserMsg)) {
    return `${banner}Here is a static sample so you can check the markdown renderer:

\`\`\`javascript
function calculateStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, sum: 0, average: 0 };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return { count: values.length, sum, average: Number((sum / values.length).toFixed(2)) };
}

console.log(calculateStats([88, 92, 79, 95, 100]));
\`\`\`
`;
  }

  return `${banner}You said: "${lastUserMsg.slice(0, 120)}"

This mode exists so the interface can be exercised with no network access and no API key.`;
}

async function runScriptedDemo(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const text = scriptedDemoResponse(messages);
  const words = text.split(' ');
  let current = '';

  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) {
      callbacks.onFinish(current);
      return;
    }
    current += (i === 0 ? '' : ' ') + words[i];
    callbacks.onChunk(current);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  callbacks.onFinish(current);
}

/* ---------- one attempt against one model ---------- */

interface AttemptResult {
  ok: boolean;
  text: string;
  streamed: boolean;
  error?: Error;
  retryable: boolean;
}

async function attemptModel(
  modelId: string,
  messages: Message[],
  systemPrompt: string,
  settings: AppSettings,
  onChunk: (text: string) => void,
  supportsImages: boolean,
  signal?: AbortSignal
): Promise<AttemptResult> {
  const route = resolveRoute(modelId);
  if (!route || route.provider === 'offline') {
    return {
      ok: false,
      text: '',
      streamed: false,
      retryable: false,
      error: new Error(
        `"${modelId}" is not a model this app knows how to reach. ` +
          'Open the model selector in the top bar and pick a listed engine.'
      ),
    };
  }

  // Normalise an empty setting to undefined: `??` only falls back on
  // null/undefined, so a blank proxyUrl would otherwise win over the real URL.
  const proxyUrl = settings.proxyUrl?.trim() || undefined;
  const apiKey = keyFor(route.provider, settings);

  if (!apiKey && !proxyUrl) {
    // `offline` already returned above, so the lookup is always defined.
    const keyUrl = PROVIDER_KEY_URL[route.provider];
    return {
      ok: false,
      text: '',
      streamed: false,
      retryable: false,
      error: new Error(
        `No ${PROVIDER_LABEL[route.provider]} API key is configured, so nothing was sent to any model.\n\n` +
          `Open Settings (⚙️) and paste a free key from ${keyUrl}, then resend your message.`
      ),
    };
  }

  // Gemini authenticates with its own header and has no OpenRouter-style
  // attribution headers. When a proxy is configured it holds the key instead,
  // so nothing is sent from the browser.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (proxyUrl) {
    // No auth header at all: the proxy owns the credential.
  } else if (route.provider === 'gemini') {
    headers['x-goog-api-key'] = apiKey as string;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (!proxyUrl && route.provider === 'openrouter') {
    const referer = getReferer();
    if (referer) headers['HTTP-Referer'] = referer;
    headers['X-Title'] = 'Kian AI';
  }

  let url: string;
  let payload: Record<string, unknown>;

  if (route.provider === 'gemini') {
    url = geminiStreamUrl(route.model);
    payload = buildGeminiPayload(messages, systemPrompt, settings, supportsImages);
  } else {
    url = route.provider === 'groq' ? GROQ_URL : OPENROUTER_URL;
    payload = {
      model: route.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: buildMessageContent(m, supportsImages) })),
      ],
      temperature: settings.temperature,
      stream: true,
    };
    if (usesCompletionTokenLimit(route.model)) {
      payload.max_completion_tokens = settings.maxTokens;
    } else {
      payload.max_tokens = settings.maxTokens;
    }
  }

  // Through a proxy the provider and slug travel in the body; the proxy is
  // what decides the real endpoint and attaches the key.
  const requestUrl = proxyUrl ?? url;
  const requestBody = proxyUrl
    ? { provider: route.provider, model: route.model, payload }
    : payload;

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err) {
    return {
      ok: false,
      text: '',
      streamed: false,
      retryable: true,
      error: new Error(
        `Could not reach ${PROVIDER_LABEL[route.provider]}: ${
          err instanceof Error ? err.message : String(err)
        }`
      ),
    };
  }

  if (!response.ok) {
    const message = await extractErrorMessage(response, route.provider);
    return {
      ok: false,
      text: '',
      streamed: false,
      retryable: RETRYABLE_STATUSES.has(response.status),
      error: new ApiError(
        message,
        response.status,
        route.provider,
        hintForStatus(response.status, route.provider, route.model)
      ),
    };
  }

  let streamed = false;
  let text = '';
  try {
    text = await (route.provider === 'gemini' ? handleGeminiSSEStream : handleSSEStream)(
      response,
      {
        onChunk: (t) => {
          streamed = true;
          onChunk(t);
        },
        onFinish: () => {},
        onError: () => {},
      },
      signal
    );
  } catch (err) {
    return {
      ok: false,
      text: '',
      streamed,
      retryable: false,
      error: new Error(`Stream failed: ${err instanceof Error ? err.message : String(err)}`),
    };
  }

  return { ok: true, text, streamed, retryable: false };
}

/* ---------- entry point ---------- */

export async function sendChatMessage(
  messages: Message[],
  systemPrompt: string,
  settings: AppSettings,
  callbacks: StreamCallbacks,
  options: SendOptions = {}
): Promise<void> {
  const { signal, knownModels = DEFAULT_MODELS } = options;
  const requested = normalizeModelId(settings.activeModelId);

  if (requested.startsWith('offline/')) {
    await runScriptedDemo(messages, callbacks, signal);
    return;
  }

  // Trim history so accumulated images cannot exceed the provider's cap.
  const outbound = pruneOldImages(messages);

  const needsImages = outbound.some(messageHasImages);
  const chain = buildModelChain(requested, settings, { knownModels, preferVision: needsImages });

  if (chain.length === 0) {
    callbacks.onError(
      new Error(
        'No API key is configured, so nothing was sent to any model.\n\n' +
          'Open Settings (⚙️) and paste a free key from https://openrouter.ai/keys or ' +
          'https://console.groq.com/keys, then resend. Alternatively choose ' +
          '"Scripted Offline Demo" to exercise the UI without a key.'
      )
    );
    return;
  }

  if (needsImages && requested !== AUTO_MODEL_ID) {
    const supports = knownModels.find((m) => m.id === requested)?.supportsImages === true;
    if (!supports) {
      callbacks.onError(
        new Error(
          `You attached an image, but ${requested} does not accept image input.\n\n` +
            'Switch to a model badged "Vision" (Gemma 4 31B or Nemotron Nano VL), or pick ' +
            '"Auto" and Kian will route to a vision-capable model for you.'
        )
      );
      return;
    }
  }

  if (needsImages && requested === AUTO_MODEL_ID) {
    const anyVision = chain.some(
      (id) => knownModels.find((m) => m.id === id)?.supportsImages === true
    );
    if (!anyVision) {
      callbacks.onError(
        new Error(
          'You attached an image, but none of the free models available to your keys accept ' +
          'image input.\n\nAdd an OpenRouter key to unlock Gemma 4 31B, or remove the image ' +
          'and ask about it in text.'
        )
      );
      return;
    }
  }

  const failures: string[] = [];
  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const modelId = chain[i];
    if (signal?.aborted) return;

    if (i > 0) callbacks.onModelUsed?.(modelId);

    const supportsImages = knownModels.find((m) => m.id === modelId)?.supportsImages === true;

    const result = await attemptModel(
      modelId,
      outbound,
      systemPrompt,
      settings,
      callbacks.onChunk,
      supportsImages,
      signal
    );

    if (result.ok) {
      callbacks.onFinish(result.text);
      return;
    }

    if (signal?.aborted) return;

    lastError = result.error ?? new Error('Request failed.');

    // Only fail over when nothing has been shown to the user yet — otherwise a
    // half-written answer would be silently replaced by a different model's.
    if (!result.retryable || result.streamed || i === chain.length - 1) break;

    failures.push(modelId);
  }

  // A single-model request has nothing to add, so pass the original error
  // through untouched and keep its type (callers check `instanceof ApiError`).
  if (failures.length === 0) {
    callbacks.onError(lastError ?? new Error('Request failed.'));
    return;
  }

  callbacks.onError(
    new Error(
      `${lastError?.message ?? 'Request failed.'}\n\n` +
        `Already tried and hit limits on: ${failures.join(', ')}.`
    )
  );
}

/**
 * Read an SSE stream, accumulating whatever text `extract` pulls out of each
 * event. Shared by the OpenAI-shaped providers and Gemini, which wrap the delta
 * differently. Returns the full text.
 */
export async function readSSE(
  response: Response,
  extract: (parsed: unknown) => string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable.');
  }

  const decoder = new TextDecoder('utf-8');
  let accumulated = '';
  let buffer = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;

    let jsonStr: string;
    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') return;
    if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
    else return;
    if (!jsonStr) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // A truncated frame split across chunk boundaries is expected; skip it.
      return;
    }

    const delta = extract(parsed);
    if (delta) {
      accumulated += delta;
      callbacks.onChunk(accumulated);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    }

    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  callbacks.onFinish(accumulated);
  return accumulated;
}

/** OpenAI-compatible shape: `choices[0].delta.content`. */
export function extractOpenAIDelta(parsed: unknown): string {
  const shape = parsed as { choices?: Array<{ delta?: { content?: string } }> };
  return shape?.choices?.[0]?.delta?.content ?? '';
}

/**
 * Gemini shape: `candidates[0].content.parts[].text`. Reasoning models emit
 * chunks that carry only a thought signature and no text, so every part has to
 * be checked rather than assuming index 0.
 */
export function extractGeminiDelta(parsed: unknown): string {
  const shape = parsed as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = shape?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

/** Parse an OpenAI-compatible SSE stream. Returns the full text. */
export async function handleSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  return readSSE(response, extractOpenAIDelta, callbacks, signal);
}

/** Parse a Gemini `streamGenerateContent` SSE stream. Returns the full text. */
export async function handleGeminiSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  return readSSE(response, extractGeminiDelta, callbacks, signal);
}
