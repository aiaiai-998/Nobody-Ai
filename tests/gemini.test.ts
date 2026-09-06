import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetExhaustionTracker } from '../src/services/aiService';

// The quota-cooldown tracker is session-wide, so a 429 in one test would
// otherwise make a later test skip that model.
beforeEach(() => resetExhaustionTracker());

import {
  buildGeminiParts,
  buildGeminiPayload,
  buildModelChain,
  extractGeminiDelta,
  handleGeminiSSEStream,
  resolveRoute,
  sendChatMessage,
  splitDataUrl,
} from '../src/services/aiService';
import { DEFAULT_MODELS } from '../src/config/constants';
import type { AppSettings, Message } from '../src/types';
import { BASE_SETTINGS, jsonResponse, recorder, sseResponse, withFetch } from './helpers';

const GEMINI_SETTINGS: AppSettings = {
  ...BASE_SETTINGS,
  activeModelId: 'gemini/gemini-2.5-flash',
  geminiApiKey: 'AIza-test-key',
};

const HISTORY: Message[] = [{ id: 'u1', role: 'user', content: 'Hello', timestamp: 0 }];

/* ---------- routing ---------- */

test('gemini model ids route to the gemini provider', () => {
  assert.deepEqual(resolveRoute('gemini/gemini-2.5-flash'), {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    requiresKey: true,
  });
  assert.deepEqual(resolveRoute('gemini/gemini-2.5-flash-lite'), {
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    requiresKey: true,
  });
  assert.equal(resolveRoute('gemini/'), null, 'empty slug must not route');
});

test('auto mode includes gemini models only when a gemini key exists', () => {
  const withKey = buildModelChain('auto/best-free', { ...GEMINI_SETTINGS }, {
    knownModels: DEFAULT_MODELS,
  });
  assert.ok(withKey.includes('gemini/gemini-2.5-flash'));

  const withoutKey = buildModelChain('auto/best-free', { ...GEMINI_SETTINGS, geminiApiKey: '' }, {
    knownModels: DEFAULT_MODELS,
  });
  assert.ok(!withoutKey.some((id) => id.startsWith('gemini/')));
});

/* ---------- data URLs ---------- */

test('splitDataUrl separates mime type from base64', () => {
  assert.deepEqual(splitDataUrl('data:image/png;base64,AAAA'), {
    mimeType: 'image/png',
    data: 'AAAA',
  });
  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,/9j/4AAQ'), {
    mimeType: 'image/jpeg',
    data: '/9j/4AAQ',
  });
  assert.equal(splitDataUrl('https://example.com/a.png'), null);
});

/* ---------- request shape ---------- */

test('buildGeminiParts emits text, and adds inline_data only for vision models', () => {
  const withImage: Message = {
    id: 'u1',
    role: 'user',
    content: 'What is this?',
    timestamp: 0,
    attachments: [
      {
        id: 'i1',
        kind: 'image',
        name: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        dataUrl: 'data:image/png;base64,AAAA',
      },
    ],
  };

  assert.deepEqual(buildGeminiParts(withImage, true), [
    { text: 'What is this?' },
    { inline_data: { mime_type: 'image/png', data: 'AAAA' } },
  ]);

  // A text-only model gets just the text — never an inline_data part it rejects.
  assert.deepEqual(buildGeminiParts(withImage, false), [{ text: 'What is this?' }]);
});

test('buildGeminiPayload uses systemInstruction and maps assistant to "model"', () => {
  const history: Message[] = [
    { id: 'u1', role: 'user', content: 'Hi', timestamp: 0 },
    { id: 'a1', role: 'assistant', content: 'Hello', timestamp: 1 },
    { id: 'u2', role: 'user', content: 'Again', timestamp: 2 },
  ];

  const payload = buildGeminiPayload(history, 'Be brief.', GEMINI_SETTINGS, false);

  assert.deepEqual(payload.systemInstruction, { parts: [{ text: 'Be brief.' }] });
  assert.deepEqual(payload.contents, [
    { role: 'user', parts: [{ text: 'Hi' }] },
    { role: 'model', parts: [{ text: 'Hello' }] },
    { role: 'user', parts: [{ text: 'Again' }] },
  ]);
  assert.deepEqual(payload.generationConfig, { temperature: 0.7, maxOutputTokens: 2048 });
  // OpenAI-only fields must not leak into a Gemini request.
  assert.equal(payload.max_tokens, undefined);
  assert.equal(payload.messages, undefined);
});

/* ---------- streaming ---------- */

test('extractGeminiDelta reads candidates[0].content.parts and ignores signature-only chunks', () => {
  assert.equal(
    extractGeminiDelta({
      candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' }, index: 0 }],
    }),
    'Hello'
  );
  // Reasoning models emit chunks with only a thought signature.
  assert.equal(
    extractGeminiDelta({ candidates: [{ content: { parts: [{ thoughtSignature: 'abc' }] } }] }),
    ''
  );
  assert.equal(extractGeminiDelta({}), '');
  assert.equal(extractGeminiDelta({ candidates: [] }), '');
});

test('handleGeminiSSEStream accumulates text across chunks with no [DONE] terminator', async () => {
  const rec = recorder();
  const response = sseResponse([
    'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"},"index":0}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"lo there"}],"role":"model"},"index":0}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":"x"}]},"finishReason":"STOP","index":0}]}\n\n',
  ]);

  const text = await handleGeminiSSEStream(response, rec.callbacks);

  assert.equal(text, 'Hello there');
  // 'Hel' + 'lo there' — the signature-only final chunk adds nothing.
  assert.deepEqual(rec.chunks, ['Hel', 'Hello there']);
});

/* ---------- end to end ---------- */

test('a gemini request uses the right URL, auth header and body', async () => {
  const rec = recorder();
  let captured: { url?: string; init?: RequestInit; body?: Record<string, unknown> } = {};

  await withFetch(
    async (input, init) => {
      captured = { url: String(input), init, body: JSON.parse(String(init?.body)) };
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi from Gemini"}],"role":"model"}}]}\n\n',
      ]);
    },
    () => sendChatMessage(HISTORY, 'Be brief.', GEMINI_SETTINGS, rec.callbacks)
  );

  assert.equal(
    captured.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
  );

  const headers = (captured.init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'AIza-test-key');
  assert.equal(headers.Authorization, undefined, 'gemini does not use a Bearer token');

  assert.deepEqual(captured.body?.systemInstruction, { parts: [{ text: 'Be brief.' }] });
  assert.deepEqual(captured.body?.contents, [{ role: 'user', parts: [{ text: 'Hello' }] }]);
  assert.equal(rec.finished, 'Hi from Gemini');
  assert.deepEqual(rec.errors, []);
});

test('an image is sent to gemini as inline_data', async () => {
  const rec = recorder();
  let body: Record<string, unknown> = {};

  const withImage: Message[] = [
    {
      id: 'u1',
      role: 'user',
      content: 'Describe it',
      timestamp: 0,
      attachments: [
        {
          id: 'i1',
          kind: 'image',
          name: 'a.png',
          mimeType: 'image/png',
          sizeBytes: 10,
          dataUrl: 'data:image/png;base64,AAAA',
        },
      ],
    },
  ];

  await withFetch(
    async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"a cat"}]}}]}\n\n']);
    },
    () => sendChatMessage(withImage, 'Be brief.', GEMINI_SETTINGS, rec.callbacks)
  );

  const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
  assert.deepEqual(contents[0].parts[1], {
    inline_data: { mime_type: 'image/png', data: 'AAAA' },
  });
  assert.equal(rec.finished, 'a cat');
});

test('a missing gemini key points at AI Studio', async () => {
  const rec = recorder();
  let fetchCalled = false;

  await withFetch(
    async () => {
      fetchCalled = true;
      return jsonResponse({});
    },
    () =>
      sendChatMessage(HISTORY, 'Be brief.', { ...GEMINI_SETTINGS, geminiApiKey: '' }, rec.callbacks)
  );

  assert.equal(fetchCalled, false);
  assert.match(rec.errors[0].message, /Gemini API key is configured/);
  assert.match(rec.errors[0].message, /aistudio\.google\.com/);
});

test('a gemini 429 carries a rate-limit hint', async () => {
  const rec = recorder();

  await withFetch(
    async () => jsonResponse({ error: { message: 'quota exceeded' } }, 429),
    () => sendChatMessage(HISTORY, 'Be brief.', GEMINI_SETTINGS, rec.callbacks)
  );

  assert.match(rec.errors[0].message, /quota exceeded/);
  assert.match(rec.errors[0].message, /Free-tier rate limit reached on Gemini/);
});

test('auto mode orders providers by quota size: Groq, then Gemini, then OpenRouter', () => {
  const chain = buildModelChain(
    'auto/best-free',
    { ...GEMINI_SETTINGS, groqApiKey: 'gsk_x', openRouterApiKey: 'sk-or-x' },
    { knownModels: DEFAULT_MODELS }
  );

  const firstGroq = chain.findIndex((id) => id.startsWith('groq/'));
  const firstGemini = chain.findIndex((id) => id.startsWith('gemini/'));
  const firstOpenRouter = chain.findIndex((id) => id.startsWith('openrouter/'));

  assert.ok(firstGroq >= 0 && firstGemini >= 0 && firstOpenRouter >= 0);
  assert.ok(firstGroq < firstGemini, 'Groq has the largest free quota, so it goes first');
  assert.ok(firstGemini < firstOpenRouter, "OpenRouter's 50/day is the tightest, so it goes last");
  assert.equal(chain.length, 12, 'every free model with a key is in the chain');
});

test('auto mode fails over from a rate-limited Groq model to Gemini', async () => {
  const rec = recorder();
  const urls: string[] = [];

  await withFetch(
    async (input) => {
      urls.push(String(input));
      // Every Groq model is rate-limited; Gemini picks it up.
      if (String(input).includes('api.groq.com')) {
        return jsonResponse({ error: { message: 'quota' } }, 429);
      }
      return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"from gemini"}]}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'Be brief.',
        { ...GEMINI_SETTINGS, groqApiKey: 'gsk_x', activeModelId: 'auto/best-free' },
        rec.callbacks
      )
  );

  assert.ok(urls.some((u) => u.includes('api.groq.com')), 'tried Groq first');
  assert.ok(urls.some((u) => u.includes('generativelanguage.googleapis.com')), 'fell over to Gemini');
  assert.equal(rec.finished, 'from gemini');
  assert.deepEqual(rec.errors, []);
  assert.ok(rec.modelsUsed.length > 0, 'the UI is told which model answered');
});

/**
 * Google AI Studio now issues keys with an `AQ.` prefix alongside the older
 * `AIza...` ones. The app must not second-guess the format: it has no way to
 * know what Google will issue next, and a strict regex would reject valid keys.
 */
test('a newer AQ.-prefixed key is sent verbatim, not rejected', async () => {
  const rec = recorder();
  const AQ_KEY = 'AQ.Ab8exampleplaceholder-not-a-real-key-xxxxxxxxxxxxxx';
  let sent = '';

  await withFetch(
    async (_input, init) => {
      const hdrs = (init?.headers ?? {}) as Record<string, string>;
      sent = hdrs['x-goog-api-key'] ?? '';
      return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, geminiApiKey: AQ_KEY, activeModelId: 'gemini/gemini-2.5-flash' },
        rec.callbacks
      )
  );

  assert.equal(sent, AQ_KEY, 'the key must reach Google untouched');
  assert.equal(rec.finished, 'ok');
});

test('the classic AIza key still works too', async () => {
  const rec = recorder();
  let sent = '';
  await withFetch(
    async (_input, init) => {
      const hdrs = (init?.headers ?? {}) as Record<string, string>;
      sent = hdrs['x-goog-api-key'] ?? '';
      return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"}}]}\n\n']);
    },
    () =>
      sendChatMessage(
        HISTORY,
        'You are helpful.',
        { ...BASE_SETTINGS, geminiApiKey: 'AIzaSyA1234567890abcdefghijklmnopqrstu', activeModelId: 'gemini/gemini-2.5-flash' },
        rec.callbacks
      )
  );
  assert.equal(sent, 'AIzaSyA1234567890abcdefghijklmnopqrstu');
  assert.equal(rec.finished, 'ok');
});
