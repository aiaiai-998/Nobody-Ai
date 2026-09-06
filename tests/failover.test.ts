import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModelChain, sendChatMessage } from '../src/services/aiService';
import { AUTO_MODEL_ID } from '../src/config/constants';
import type { AIModel, AppSettings, Message } from '../src/types';
import {
  BASE_SETTINGS,
  brokenStreamResponse,
  countingFetch,
  jsonResponse,
  recorder,
  sseResponse,
  withFetch,
} from './helpers';

const CATALOG: AIModel[] = [
  {
    id: AUTO_MODEL_ID,
    name: 'Auto',
    provider: 'Auto',
    description: '',
    badge: '',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
  },
  {
    id: 'groq/openai/gpt-oss-120b',
    name: 'Groq 120B',
    provider: 'Groq',
    description: '',
    badge: '',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },
  {
    id: 'groq/openai/gpt-oss-20b',
    name: 'Groq 20B',
    provider: 'Groq',
    description: '',
    badge: '',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },
  {
    id: 'openrouter/google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B',
    provider: 'OpenRouter',
    description: '',
    badge: '',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
    supportsImages: true,
  },
  {
    id: 'offline/scripted-demo',
    name: 'Scripted Offline Demo',
    provider: 'Offline demo',
    description: '',
    badge: '',
    isFreeByDefault: true,
    requiresKey: false,
    speed: 'Ultra Fast',
  },
];

const BOTH_KEYS: AppSettings = {
  ...BASE_SETTINGS,
  openRouterApiKey: 'sk-or-v1-test',
  groqApiKey: 'gsk_test',
};

const IMAGE_MESSAGE: Message = {
  id: 'u2',
  role: 'user',
  content: 'What is in this picture?',
  timestamp: 0,
  attachments: [
    {
      id: 'a1',
      kind: 'image',
      name: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      dataUrl: 'data:image/png;base64,AAAA',
    },
  ],
};

/* ---------- chain construction ---------- */

test('a specific model request is not expanded into a chain', () => {
  assert.deepEqual(buildModelChain('groq/openai/gpt-oss-20b', BOTH_KEYS, { knownModels: CATALOG }), [
    'groq/openai/gpt-oss-20b',
  ]);
});

test('auto mode chains every free model the user has a key for', () => {
  assert.deepEqual(buildModelChain(AUTO_MODEL_ID, BOTH_KEYS, { knownModels: CATALOG }), [
    'groq/openai/gpt-oss-120b',
    'groq/openai/gpt-oss-20b',
    'openrouter/google/gemma-4-31b-it:free',
  ]);
});

test('auto mode only chains providers the user actually has keys for', () => {
  assert.deepEqual(
    buildModelChain(AUTO_MODEL_ID, { ...BOTH_KEYS, openRouterApiKey: '' }, {
      knownModels: CATALOG,
    }),
    ['groq/openai/gpt-oss-120b', 'groq/openai/gpt-oss-20b']
  );
});

test('auto mode with no keys yields an empty chain', () => {
  assert.deepEqual(buildModelChain(AUTO_MODEL_ID, BASE_SETTINGS, { knownModels: CATALOG }), []);
});

test('auto mode puts vision models first when an image is attached', () => {
  assert.deepEqual(
    buildModelChain(AUTO_MODEL_ID, BOTH_KEYS, { knownModels: CATALOG, preferVision: true }),
    [
      'openrouter/google/gemma-4-31b-it:free',
      'groq/openai/gpt-oss-120b',
      'groq/openai/gpt-oss-20b',
    ]
  );
});

/* ---------- failover behaviour ---------- */

test('auto mode moves to the next model when the first is rate-limited', async () => {
  const rec = recorder();
  const fetcher = countingFetch(async (call) =>
    call === 0
      ? jsonResponse({ error: { message: 'rate limited' } }, 429)
      : sseResponse(['data: {"choices":[{"delta":{"content":"second model answered"}}]}\n\n'])
  );

  await withFetch(fetcher.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec.callbacks,
      { knownModels: CATALOG }
    )
  );

  assert.equal(fetcher.calls, 2, 'exactly two models attempted');
  assert.equal(rec.finished, 'second model answered');
  assert.deepEqual(rec.errors, []);
  assert.deepEqual(rec.modelsUsed, ['groq/openai/gpt-oss-20b']);
});

test('when every model is exhausted the error names the ones already tried', async () => {
  const rec = recorder();
  const fetcher = countingFetch(async () =>
    jsonResponse({ error: { message: 'slow down' } }, 429)
  );

  await withFetch(fetcher.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec.callbacks,
      { knownModels: CATALOG }
    )
  );

  assert.equal(fetcher.calls, 3, 'every model in the chain was attempted');
  assert.equal(rec.finished, null);
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /slow down/);
  assert.match(rec.errors[0].message, /Already tried and hit limits on:/);
  assert.match(rec.errors[0].message, /groq\/openai\/gpt-oss-120b/);
});

test('a model that already streamed output is not replaced by another model', async () => {
  const rec = recorder();
  const fetcher = countingFetch(async () =>
    brokenStreamResponse(['data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'])
  );

  await withFetch(fetcher.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec.callbacks,
      { knownModels: CATALOG }
    )
  );

  assert.equal(fetcher.calls, 1, 'must not silently switch model mid-answer');
  assert.deepEqual(rec.modelsUsed, []);
  assert.match(rec.errors[0].message, /Stream failed/);
});

test('an auth failure is not retried against other models', async () => {
  const rec = recorder();
  const fetcher = countingFetch(async () => jsonResponse({ error: { message: 'bad key' } }, 401));

  await withFetch(fetcher.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec.callbacks,
      { knownModels: CATALOG }
    )
  );

  assert.equal(fetcher.calls, 1, 'a bad key will fail everywhere, so do not burn quota');
  assert.match(rec.errors[0].message, /console\.groq\.com\/keys/);
});

test('auto mode with no keys explains how to get one', async () => {
  const rec = recorder();
  await sendChatMessage(
    [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
    'You are helpful.',
    { ...BASE_SETTINGS, activeModelId: AUTO_MODEL_ID },
    rec.callbacks,
    { knownModels: CATALOG }
  );
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /No API key is configured/);
});

/* ---------- image routing ---------- */

test('attaching an image to a text-only model is refused with a clear message', async () => {
  const rec = recorder();
  let fetchCalled = false;

  await withFetch(
    async () => {
      fetchCalled = true;
      return jsonResponse({});
    },
    () =>
      sendChatMessage(
        [IMAGE_MESSAGE],
        'You are helpful.',
        { ...BOTH_KEYS, activeModelId: 'groq/openai/gpt-oss-20b' },
        rec.callbacks,
        { knownModels: CATALOG }
      )
  );

  assert.equal(fetchCalled, false, 'must not send an image to a model that rejects it');
  assert.match(rec.errors[0].message, /does not accept image input/);
  assert.match(rec.errors[0].message, /Vision/);
});

test('auto mode routes an image to the vision model and sends it as a content array', async () => {
  const rec = recorder();
  let body: Record<string, unknown> = {};
  const urls: string[] = [];

  await withFetch(
    async (input, init) => {
      urls.push(String(input));
      body = JSON.parse(String(init?.body));
      return sseResponse(['data: {"choices":[{"delta":{"content":"a cat"}}]}\n\n']);
    },
    () =>
      sendChatMessage([IMAGE_MESSAGE], 'You are helpful.', { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID }, rec.callbacks, {
        knownModels: CATALOG,
      })
  );

  assert.equal(urls[0], 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(body.model, 'google/gemma-4-31b-it:free');

  const sent = (body.messages as Array<Record<string, unknown>>)[1];
  assert.ok(Array.isArray(sent.content), 'content must be a parts array for images');
  const parts = sent.content as Array<Record<string, unknown>>;
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[1].type, 'image_url');
  assert.deepEqual(parts[1].image_url, { url: 'data:image/png;base64,AAAA' });
  assert.equal(rec.finished, 'a cat');
});
