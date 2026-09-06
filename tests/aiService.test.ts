import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  fetchOpenRouterFreeModels,
  handleSSEStream,
  normalizeModelId,
  resolveRoute,
  sendChatMessage,
  type StreamCallbacks,
} from '../src/services/aiService';
import type { AppSettings, Message } from '../src/types';

/* ---------- helpers ---------- */

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recorder() {
  const chunks: string[] = [];
  const errors: Error[] = [];
  let finished: string | null = null;
  const callbacks: StreamCallbacks = {
    onChunk: (text) => chunks.push(text),
    onFinish: (text) => {
      finished = text;
    },
    onError: (err) => errors.push(err),
  };
  return {
    chunks,
    errors,
    get finished() {
      return finished;
    },
    callbacks,
  };
}

const BASE_SETTINGS: AppSettings = {
  activeModelId: 'openrouter/openai/gpt-oss-20b:free',
  activePersonaId: 'general',
  openRouterApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  temperature: 0.7,
  maxTokens: 2048,
  autoSpeech: false,
};

const HISTORY: Message[] = [
  { id: 'u1', role: 'user', content: 'Hello there', timestamp: 0 },
];

async function withFetch<T>(
  impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    value: impl,
    writable: true,
    configurable: true,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      value: original,
      writable: true,
      configurable: true,
    });
  }
}

/* ---------- routing ---------- */

test('resolveRoute forwards the upstream slug verbatim', () => {
  assert.deepEqual(resolveRoute('openrouter/openai/gpt-oss-20b:free'), {
    provider: 'openrouter',
    model: 'openai/gpt-oss-20b:free',
    requiresKey: true,
  });
  assert.deepEqual(resolveRoute('groq/openai/gpt-oss-120b'), {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    requiresKey: true,
  });
  assert.deepEqual(resolveRoute('offline/scripted-demo'), {
    provider: 'offline',
    model: 'scripted-demo',
    requiresKey: false,
  });
});

test('resolveRoute migrates the retired Groq and OpenRouter model ids', () => {
  // Both llama slugs were shut down by Groq on 2026-08-16; saved settings
  // referencing them must be mapped onto a model that still exists.
  assert.deepEqual(resolveRoute('groq/llama-3.3-70b'), {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    requiresKey: true,
  });
  assert.equal(normalizeModelId('openrouter/qwen-2.5-7b'), 'openrouter/openai/gpt-oss-20b:free');
  assert.equal(normalizeModelId('openrouter/gemma-2-9b'), 'openrouter/google/gemma-4-31b-it:free');
  assert.equal(normalizeModelId('local/client-offline'), 'offline/scripted-demo');
  // Unknown ids are left alone rather than silently rewritten.
  assert.equal(normalizeModelId('openrouter/some/new-model:free'), 'openrouter/some/new-model:free');
});

test('resolveRoute rejects unroutable ids instead of guessing', () => {
  assert.equal(
    resolveRoute('openrouter/qwen-2.5-99b'),
    null,
    'bare name with no slug separator and no alias entry'
  );
  assert.equal(resolveRoute('anthropic/claude'), null, 'provider this app cannot reach');
  assert.equal(resolveRoute(''), null);
});

/* ---------- SSE parsing ---------- */

test('handleSSEStream accumulates deltas across chunk boundaries', async () => {
  const rec = recorder();
  // A single `data:` frame split across three network chunks.
  const response = sseResponse([
    'data: {"choices":[{"delta":{"con',
    'tent":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);

  await handleSSEStream(response, rec.callbacks);

  assert.deepEqual(rec.chunks, ['Hello', 'Hello world']);
  assert.equal(rec.finished, 'Hello world');
  assert.deepEqual(rec.errors, []);
});

test('handleSSEStream tolerates CRLF, comments, blank lines and a missing [DONE]', async () => {
  const rec = recorder();
  const response = sseResponse([
    ': keep-alive\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\n',
    '\r\n',
    'data: {"choices":[{"delta":{"content":"B"}}]}\r\n',
  ]);

  await handleSSEStream(response, rec.callbacks);

  assert.equal(rec.finished, 'AB');
  assert.deepEqual(rec.errors, []);
});

test('handleSSEStream reports an empty result when the provider sends no content', async () => {
  const rec = recorder();
  await handleSSEStream(sseResponse(['data: [DONE]\n\n']), rec.callbacks);
  assert.equal(rec.finished, '');
  assert.deepEqual(rec.chunks, []);
});

/* ---------- sendChatMessage ---------- */

test('a missing API key errors out rather than fabricating an answer', async () => {
  const rec = recorder();
  let fetchCalled = false;

  await withFetch(
    async () => {
      fetchCalled = true;
      return jsonResponse({});
    },
    () => sendChatMessage(HISTORY, 'You are helpful.', BASE_SETTINGS, rec.callbacks)
  );

  assert.equal(fetchCalled, false, 'must not hit the network without a key');
  assert.equal(rec.finished, null, 'must not produce a fake completion');
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /API key is configured, so nothing was sent/);
  assert.match(rec.errors[0].message, /openrouter\.ai\/keys/);
});

test('an unroutable saved model id is reported, not substituted', async () => {
  const rec = recorder();
  await sendChatMessage(
    HISTORY,
    'You are helpful.',
    { ...BASE_SETTINGS, activeModelId: 'anthropic/claude' },
    rec.callbacks
  );
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /not a model this app knows how to reach/);
  assert.equal(rec.finished, null);
});

test('a successful OpenRouter call sends the right payload and streams back', async () => {
  const rec = recorder();
  let captured: { url?: string; init?: RequestInit; body?: Record<string, unknown> } = {};

  await withFetch(
    async (input, init) => {
      captured = { url: String(input), init, body: JSON.parse(String(init?.body)) };
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Streaming"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" works"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, openRouterApiKey: 'sk-or-v1-test' },
        rec.callbacks
      )
  );

  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  const headers = (captured.init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer sk-or-v1-test');
  assert.equal(captured.body?.model, 'openai/gpt-oss-20b:free');
  assert.equal(captured.body?.stream, true);
  // gpt-oss is a reasoning-style model: it takes max_completion_tokens, not max_tokens.
  assert.equal(captured.body?.max_completion_tokens, 2048);
  assert.equal(captured.body?.max_tokens, undefined);
  const sent = (captured.body?.messages ?? []) as Array<Record<string, string>>;
  assert.deepEqual(sent[0], { role: 'system', content: 'You are helpful.' });
  assert.equal(rec.finished, 'Streaming works');
  assert.deepEqual(rec.errors, []);
});

test('Groq routes to the Groq endpoint and migrates the legacy llama id', async () => {
  const rec = recorder();
  let captured: { url?: string; body?: Record<string, unknown> } = {};

  await withFetch(
    async (input, init) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        {
          ...BASE_SETTINGS,
          activeModelId: 'groq/llama-3.3-70b', // legacy id -> gpt-oss-120b
          groqApiKey: 'gsk_test',
        },
        rec.callbacks
      )
  );

  assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(captured.body?.model, 'openai/gpt-oss-120b');
  assert.equal(captured.body?.max_completion_tokens, 2048);
  assert.equal(rec.finished, 'ok');
});

test('non-reasoning models get max_tokens rather than max_completion_tokens', async () => {
  const rec = recorder();
  let captured: Record<string, unknown> = {};

  await withFetch(
    async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        {
          ...BASE_SETTINGS,
          activeModelId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
          openRouterApiKey: 'sk-or-v1-test',
        },
        rec.callbacks
      )
  );

  assert.equal(captured.model, 'meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(captured.max_tokens, 2048);
  assert.equal(captured.max_completion_tokens, undefined);
});

test('a 429 surfaces an ApiError carrying an actionable hint', async () => {
  const rec = recorder();

  await withFetch(
    async () =>
      jsonResponse(
        { error: { message: 'Rate limit exceeded for free tier' } },
        429
      ),
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, openRouterApiKey: 'sk-or-v1-test' },
        rec.callbacks
      )
  );

  assert.equal(rec.errors.length, 1);
  const err = rec.errors[0];
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 429);
  assert.equal(err.provider, 'openrouter');
  assert.match(err.message, /Rate limit exceeded for free tier/);
  assert.match(err.message, /Free-tier rate limit reached/);
  assert.equal(rec.finished, null);
});

test('a 401 points the user at the key settings', async () => {
  const rec = recorder();
  await withFetch(
    async () => jsonResponse({ error: { message: 'Invalid key' } }, 401),
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, groqApiKey: 'gsk_bad', activeModelId: 'groq/openai/gpt-oss-20b' },
        rec.callbacks
      )
  );
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /console\.groq\.com\/keys/);
});

test('a network failure is reported as an error, not masked by a canned reply', async () => {
  const rec = recorder();
  await withFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, openRouterApiKey: 'sk-or-v1-test' },
        rec.callbacks
      )
  );
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /Could not reach OpenRouter: Failed to fetch/);
  assert.equal(rec.finished, null);
});

test('aborting mid-stream stops quietly without reporting an error', async () => {
  const rec = recorder();
  const controller = new AbortController();

  await withFetch(
    async () => {
      // Simulate the provider still streaming while the user presses Stop.
      controller.abort();
      return sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, openRouterApiKey: 'sk-or-v1-test' },
        rec.callbacks,
        { signal: controller.signal }
      )
  );

  assert.deepEqual(rec.errors, [], 'user-initiated stop is not an error');
});

test('the offline demo is clearly labelled as not a language model', async () => {
  const rec = recorder();
  await sendChatMessage(
    [{ id: 'u1', role: 'user', content: 'hello', timestamp: 0 }],
    'You are helpful.',
    { ...BASE_SETTINGS, activeModelId: 'offline/scripted-demo' },
    rec.callbacks
  );
  assert.ok(rec.finished, 'offline demo still completes');
  assert.match(rec.finished, /Scripted Offline Demo/);
  assert.match(rec.finished, /not by a language model/);
});

/* ---------- live catalog ---------- */

test('fetchOpenRouterFreeModels keeps only :free models and caps the list', async () => {
  const data = Array.from({ length: 20 }, (_, i) => ({
    id: `vendor/model-${i}:free`,
    name: `Model ${i}`,
    context_length: i * 1000,
    description: 'x'.repeat(300),
  }));
  data.push({ id: 'vendor/paid-model', name: 'Paid', context_length: 99999, description: 'nope' });

  const models = await withFetch(async () => jsonResponse({ data }), () =>
    fetchOpenRouterFreeModels()
  );

  assert.equal(models.length, 12, 'caps the discovery list at 12');
  assert.ok(models.every((m) => m.id.endsWith(':free')), 'drops paid models');
  assert.ok(models.every((m) => m.id.startsWith('openrouter/')), 'prefixes ids for routing');
  assert.ok(models.every((m) => m.fromLiveCatalog === true));
  assert.ok(
    models.every((m) => m.description.length <= 140),
    'truncates long descriptions for the dropdown'
  );
  // Sorted by context window, descending.
  assert.equal(models[0].id, 'openrouter/vendor/model-19:free');
  // The discovered id must round-trip through the router.
  assert.deepEqual(resolveRoute(models[0].id)?.model, 'vendor/model-19:free');
});

test('fetchOpenRouterFreeModels reads vision support from input_modalities', async () => {
  const data = [
    { id: 'vendor/vision-model:free', name: 'Vision', context_length: 1000,
      architecture: { input_modalities: ['text', 'image'] } },
    { id: 'vendor/text-model:free', name: 'Text', context_length: 2000,
      architecture: { input_modalities: ['text'] } },
  ];

  const models = await withFetch(async () => jsonResponse({ data }), () =>
    fetchOpenRouterFreeModels()
  );

  const vision = models.find((m) => m.id === 'openrouter/vendor/vision-model:free');
  const text = models.find((m) => m.id === 'openrouter/vendor/text-model:free');
  assert.equal(vision?.supportsImages, true);
  assert.match(vision?.badge ?? '', /Vision/);
  assert.equal(text?.supportsImages, false);
});

test('fetchOpenRouterFreeModels rejects a non-OK catalog response', async () => {
  await assert.rejects(
    () => withFetch(async () => jsonResponse({ error: 'nope' }, 503), () => fetchOpenRouterFreeModels()),
    /OpenRouter model list returned HTTP 503/
  );
});
