import type { AIModel, AppSettings, Message } from '../types';
import { LEGACY_MODEL_ALIASES } from '../config/constants';

export interface StreamCallbacks {
  /** Called with the full accumulated text so far (not just the newest delta). */
  onChunk: (text: string) => void;
  onFinish: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface SendOptions {
  /** Aborting this signal cancels the request and the stream reader. */
  signal?: AbortSignal;
}

export type ProviderId = 'openrouter' | 'groq' | 'offline';

export interface Route {
  provider: ProviderId;
  /** Upstream model slug forwarded verbatim to the provider. */
  model: string;
  requiresKey: boolean;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  offline: 'offline demo',
};

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

  return null;
}

/** Models that only accept `max_completion_tokens` (OpenAI reasoning-style APIs). */
function usesCompletionTokenLimit(model: string): boolean {
  return /(^|\/)gpt-oss-/.test(model);
}

function getReferer(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) return undefined;
  return window.location.origin;
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
  const keyUrl = provider === 'groq' ? 'https://console.groq.com/keys' : 'https://openrouter.ai/keys';

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
      created?: number;
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
      return {
        id: `openrouter/${m.id}`,
        name: m.name ?? m.id,
        provider: 'OpenRouter',
        description: (m.description ?? '').slice(0, 140) || 'Free model from the live OpenRouter catalog.',
        badge: `Free${contextLabel}`,
        isFreeByDefault: true,
        requiresKey: true,
        speed: 'Fast',
        fromLiveCatalog: true,
      };
    });

  return models;
}

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

export async function sendChatMessage(
  messages: Message[],
  systemPrompt: string,
  settings: AppSettings,
  callbacks: StreamCallbacks,
  options: SendOptions = {}
): Promise<void> {
  const { signal } = options;
  const route = resolveRoute(settings.activeModelId);

  if (!route) {
    callbacks.onError(
      new Error(
        `"${settings.activeModelId}" is not a model this app knows how to reach. ` +
          'Open the model selector in the top bar and pick a listed engine.'
      )
    );
    return;
  }

  if (route.provider === 'offline') {
    await runScriptedDemo(messages, callbacks, signal);
    return;
  }

  const apiKey =
    route.provider === 'groq'
      ? settings.groqApiKey?.trim()
      : settings.openRouterApiKey?.trim();

  if (!apiKey) {
    const keyUrl =
      route.provider === 'groq'
        ? 'https://console.groq.com/keys'
        : 'https://openrouter.ai/keys';
    callbacks.onError(
      new Error(
        `No ${PROVIDER_LABEL[route.provider]} API key configured, so nothing was sent to any model.\n\n` +
          `Open Settings (⚙️) and paste a free key from ${keyUrl}, then resend your message. ` +
          'Alternatively choose "Scripted Offline Demo" to exercise the UI without a key.'
      )
    );
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (route.provider === 'openrouter') {
    const referer = getReferer();
    if (referer) headers['HTTP-Referer'] = referer;
    headers['X-Title'] = 'Kian AI';
  }

  const payload: Record<string, unknown> = {
    model: route.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: settings.temperature,
    stream: true,
  };

  if (usesCompletionTokenLimit(route.model)) {
    payload.max_completion_tokens = settings.maxTokens;
  } else {
    payload.max_tokens = settings.maxTokens;
  }

  let response: Response;
  try {
    response = await fetch(route.provider === 'groq' ? GROQ_URL : OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(
      new Error(
        `Could not reach ${PROVIDER_LABEL[route.provider]}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    );
    return;
  }

  if (!response.ok) {
    const message = await extractErrorMessage(response, route.provider);
    callbacks.onError(
      new ApiError(message, response.status, route.provider, hintForStatus(response.status, route.provider, route.model))
    );
    return;
  }

  try {
    await handleSSEStream(response, callbacks, signal);
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(new Error(`Stream failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

/**
 * Parse an OpenAI-compatible SSE stream, emitting the accumulated text on each
 * content delta. Exported for testing.
 */
export async function handleSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
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

    let parsed: { choices?: Array<{ delta?: { content?: string } }> };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // A truncated frame split across chunk boundaries is expected; skip it.
      return;
    }

    const delta = parsed.choices?.[0]?.delta?.content;
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
}
