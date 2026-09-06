import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createExhaustionTracker,
  msUntilUtcMidnight,
  resetExhaustionTracker,
} from '../src/services/aiService';

// The quota-cooldown tracker is session-wide, so a 429 in one test would
// otherwise make a later test skip that model.
beforeEach(() => resetExhaustionTracker());

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

test('a long image history is trimmed before it reaches the provider', async () => {
  const rec = recorder();
  let body: Record<string, unknown> = {};

  const img = (id: string) => ({
    id,
    kind: 'image' as const,
    name: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    dataUrl: `data:image/png;base64,${id}`,
  });

  // Six messages, two images each = 12 image parts, over the cap of 10.
  const history: Message[] = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`,
    role: 'user' as const,
    content: `turn ${i}`,
    timestamp: i,
    attachments: [img(`a${i}x`), img(`a${i}y`)],
  }));

  await withFetch(
    async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
    },
    () =>
      sendChatMessage(history, 'You are helpful.', { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID }, rec.callbacks, {
        knownModels: CATALOG,
      })
  );

  const sent = body.messages as Array<{ content: unknown }>;
  const imageParts = sent
    .filter((m) => Array.isArray(m.content))
    .flatMap((m) => m.content as Array<{ type: string }>)
    .filter((part) => part.type === 'image_url');

  assert.equal(imageParts.length, 10, 'trimmed to the per-request cap');

  // The newest turns keep their images; the oldest lose them.
  const last = sent[sent.length - 1].content as Array<{ type: string }>;
  assert.equal(last.filter((p) => p.type === 'image_url').length, 2);
  const first = sent[1].content;
  assert.equal(typeof first, 'string', 'oldest message degraded to plain text');
});

/* ---------- quota cooldowns ---------- */

test('a first 429 cools a model down briefly, then lets it back in', () => {
  const t = createExhaustionTracker();
  const now = 1_000_000;
  t.mark('groq/x', now);
  assert.equal(t.isBlocked('groq/x', now + 1), true);
  assert.equal(t.isBlocked('groq/x', now + 59_999), true);
  assert.equal(t.isBlocked('groq/x', now + 60_001), false, 'an RPM limit clears in a minute');
});

test('cooldowns escalate, because a third 429 means the day is gone', () => {
  const t = createExhaustionTracker();
  const now = 1_000_000;
  t.mark('groq/x', now); // 60s
  assert.equal(t.isBlocked('groq/x', now + 61_000), false, 'the short window has passed');

  t.mark('groq/x', now + 62_000); // 10 min, starting from the second strike
  assert.equal(t.isBlocked('groq/x', now + 120_000), true, 'past 60s but still blocked: it escalated');
  assert.equal(t.isBlocked('groq/x', now + 62_000 + 601_000), false, 'and it does clear eventually');

  t.mark('groq/x', now + 63_000); // rest of the UTC day
  assert.equal(t.isBlocked('groq/x', now + 700_000), true, 'daily quota will not come back soon');
});

test('a model that answers again has its strikes forgiven', () => {
  const t = createExhaustionTracker();
  const now = 1_000_000;
  t.mark('groq/x', now);
  t.mark('groq/x', now + 1);
  t.clearModel('groq/x');
  assert.equal(t.isBlocked('groq/x', now + 2), false);
  t.mark('groq/x', now + 3);
  assert.equal(t.isBlocked('groq/x', now + 4_000), true, 'a fresh strike blocks it again');
  // Under the 10-minute window this would still be blocked; forgiven, it is not.
  assert.equal(t.isBlocked('groq/x', now + 63_000 + 60_000), false, 'back to the short window');
});

test('msUntilUtcMidnight counts down to the next UTC day boundary', () => {
  // 2026-01-01T23:59:00Z -> 60s left
  const t = Date.UTC(2026, 0, 1, 23, 59, 0);
  assert.equal(msUntilUtcMidnight(t), 60_000);
  // exactly midnight -> a full day
  assert.equal(msUntilUtcMidnight(Date.UTC(2026, 0, 1, 0, 0, 0)), 86_400_000);
  // rolls over month ends
  assert.equal(msUntilUtcMidnight(Date.UTC(2026, 0, 31, 12, 0, 0)), 43_200_000);
});

test('the next message skips a model that already ran out', async () => {
  // First message: the preferred Groq model is out of quota, so the chain
  // moves on. Second message must not rediscover that the hard way.
  const first = countingFetch(async (call) =>
    call === 0
      ? jsonResponse({ error: { message: 'slow down' } }, 429)
      : sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n'])
  );
  const rec1 = recorder();
  await withFetch(first.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec1.callbacks,
      { knownModels: CATALOG }
    )
  );
  assert.equal(first.calls, 2, 'first message tried the dead model, then succeeded');
  assert.equal(rec1.finished, 'ok');

  const second = countingFetch(async () =>
    sseResponse(['data: {"choices":[{"delta":{"content":"fast"}}]}\n\n', 'data: [DONE]\n\n'])
  );
  const rec2 = recorder();
  await withFetch(second.impl, () =>
    sendChatMessage(
      [{ id: 'u2', role: 'user', content: 'again', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec2.callbacks,
      { knownModels: CATALOG }
    )
  );
  assert.equal(second.calls, 1, 'the exhausted model was skipped entirely');
  assert.equal(second.urls[0], 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(rec2.finished, 'fast');
});

test('when everything is cooling down it still tries rather than refusing', async () => {
  const fetcher = countingFetch(async () =>
    sseResponse(['data: {"choices":[{"delta":{"content":"still works"}}]}\n\n', 'data: [DONE]\n\n'])
  );
  const rec = recorder();

  // Burn every model in the chain first.
  const burn = countingFetch(async () => jsonResponse({ error: { message: 'slow down' } }, 429));
  await withFetch(burn.impl, () =>
    sendChatMessage(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      recorder().callbacks,
      { knownModels: CATALOG }
    )
  );
  assert.ok(burn.calls >= 2, 'expected the chain to be exhausted');

  await withFetch(fetcher.impl, () =>
    sendChatMessage(
      [{ id: 'u2', role: 'user', content: 'hi again', timestamp: 0 }],
      'You are helpful.',
      { ...BOTH_KEYS, activeModelId: AUTO_MODEL_ID },
      rec.callbacks,
      { knownModels: CATALOG }
    )
  );
  assert.ok(fetcher.calls > 0, 'must attempt something, not silently refuse');
  assert.equal(rec.finished, 'still works');
});
