import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import handler, { resolveUpstream } from '../api/chat';
import { buildModelChain, hasUsableCredential, sendChatMessage } from '../src/services/aiService';
import { BASE_SETTINGS, HISTORY, jsonResponse, recorder, sseResponse, withFetch } from './helpers';

const SSE_OK = [
  'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
  'data: [DONE]\n\n',
];

/** Gemini's wire format: no `[DONE]`, text lives under candidates[].content.parts. */
const SSE_GEMINI = [
  'data: {"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"},"finishReason":"STOP"}]}\n\n',
];

/**
 * The proxy exists because a key compiled into the client bundle is public.
 * These pin the security-critical half: a caller cannot pick the provider
 * freely, cannot aim the server at another endpoint, and cannot make it reveal
 * which key is missing.
 */
describe('resolveUpstream (server side)', () => {
  const env = {
    OPENROUTER_API_KEY: 'sk-or-secret',
    GROQ_API_KEY: 'gsk-secret',
    GEMINI_API_KEY: 'AIza-secret',
  };

  it('routes each provider to its real endpoint with the right auth header', () => {
    const or = resolveUpstream('openrouter', 'openai/gpt-oss-20b:free', env);
    assert.equal(or.ok, true);
    if (or.ok) {
      assert.equal(or.upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(or.upstream.headers.Authorization, 'Bearer sk-or-secret');
    }

    const gr = resolveUpstream('groq', 'openai/gpt-oss-120b', env);
    assert.equal(gr.ok, true);
    if (gr.ok) assert.equal(gr.upstream.url, 'https://api.groq.com/openai/v1/chat/completions');

    const ge = resolveUpstream('gemini', 'gemini-2.5-flash', env);
    assert.equal(ge.ok, true);
    if (ge.ok) {
      assert.equal(
        ge.upstream.url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
      );
      assert.equal(ge.upstream.headers['x-goog-api-key'], 'AIza-secret');
    }
  });

  it('rejects an unknown or attacker-chosen provider', () => {
    for (const bad of ['evil', '', null, undefined, 'openai', 0]) {
      const r = resolveUpstream(bad, 'some-model', env);
      assert.equal(r.ok, false, `provider ${String(bad)} must be rejected`);
      if (!r.ok) assert.equal(r.status, 400);
    }
  });

  it('rejects a missing model', () => {
    for (const bad of ['   ', '', null, undefined, 42]) {
      const r = resolveUpstream('groq', bad, env);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, 400);
    }
  });

  it('says a key is missing without naming it or any other variable', () => {
    const r = resolveUpstream('groq', 'openai/gpt-oss-120b', {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 503);
      assert.doesNotMatch(r.message, /GROQ_API_KEY/);
      assert.doesNotMatch(r.message, /OPENROUTER/);
      assert.doesNotMatch(r.message, /GEMINI/);
    }
  });

  it('does not accept a blank key', () => {
    const r = resolveUpstream('gemini', 'gemini-2.5-flash', { GEMINI_API_KEY: '   ' });
    assert.equal(r.ok, false);
  });

  it('rejects a model id trying to escape into another path', () => {
    // encodeURIComponent leaves "." alone, so encoding alone is not enough.
    for (const bad of ['../v1/models/gemini-2.5-pro', 'a/../b', 'model?x=1', 'model#f', 'a b']) {
      const r = resolveUpstream('gemini', bad, env);
      assert.equal(r.ok, false, `${bad} must be rejected`);
      if (!r.ok) assert.equal(r.status, 400);
    }
  });

  it('accepts real model ids including OpenRouter suffixes', () => {
    for (const good of ['gemini-2.5-flash', 'openai/gpt-oss-20b:free', 'moonshotai/kimi-k2-instruct']) {
      assert.equal(resolveUpstream('openrouter', good, env).ok, true, `${good} must be accepted`);
    }
  });
});

describe('proxy routing (client side)', () => {
  it('posts provider, model and payload to the proxy and sends no key', async () => {
    const rec = recorder();
    let captured: { url?: string; headers?: Record<string, string>; body?: Record<string, unknown> } = {};

    await withFetch(
      async (input, init) => {
        captured = {
          url: String(input),
          headers: init?.headers as Record<string, string>,
          body: JSON.parse(String(init?.body)),
        };
        return sseResponse(SSE_GEMINI);
      },
      () =>
        sendChatMessage(
          HISTORY,
          'You are helpful.',
          { ...BASE_SETTINGS, proxyUrl: '/api/chat', activeModelId: 'gemini/gemini-2.5-flash' },
          rec.callbacks
        )
    );

    assert.equal(captured.url, '/api/chat');
    assert.equal(captured.headers?.Authorization, undefined, 'the browser must not send a key');
    assert.equal(captured.headers?.['x-goog-api-key'], undefined);
    assert.equal(captured.body?.provider, 'gemini');
    assert.equal(captured.body?.model, 'gemini-2.5-flash');
    const nested = (captured.body?.payload ?? {}) as { contents?: unknown };
    assert.ok(Array.isArray(nested.contents), 'the provider payload travels nested');
    assert.equal(rec.finished, 'hi');
  });

  it('lets every provider into auto mode when only a proxy is configured', () => {
    const chain = buildModelChain('auto/best-free', { ...BASE_SETTINGS, proxyUrl: '/api/chat' });
    assert.equal(chain.length, 12);
    assert.ok(chain.some((id) => id.startsWith('openrouter/')));
    assert.ok(chain.some((id) => id.startsWith('gemini/')));
    assert.ok(chain.some((id) => id.startsWith('groq/')));
  });

  it('passes a provider error coming back through the proxy to the user', async () => {
    const rec = recorder();
    await withFetch(
      async () => jsonResponse({ error: { message: 'Rate limit reached.' } }, 429),
      () =>
        sendChatMessage(
          HISTORY,
          'You are helpful.',
          { ...BASE_SETTINGS, proxyUrl: '/api/chat', activeModelId: 'groq/openai/gpt-oss-120b' },
          rec.callbacks
        )
    );
    assert.equal(rec.finished, null);
    assert.equal(rec.errors.length, 1);
    assert.match(rec.errors[0].message, /Rate limit/);
  });

  it('falls back to the direct call, with the key, when no proxy is set', async () => {
    const rec = recorder();
    let captured: { url?: string; headers?: Record<string, string> } = {};

    await withFetch(
      async (input, init) => {
        captured = { url: String(input), headers: init?.headers as Record<string, string> };
        return sseResponse(SSE_OK);
      },
      () =>
        sendChatMessage(
          HISTORY,
          'You are helpful.',
          { ...BASE_SETTINGS, groqApiKey: 'gsk-direct', activeModelId: 'groq/openai/gpt-oss-120b' },
          rec.callbacks
        )
    );

    assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(captured.headers?.Authorization, 'Bearer gsk-direct');
  });

  it('a blank proxyUrl is treated as no proxy, not as an empty endpoint', async () => {
    const rec = recorder();
    let url = '';
    await withFetch(
      async (input) => {
        url = String(input);
        return sseResponse(SSE_OK);
      },
      () =>
        sendChatMessage(
          HISTORY,
          'You are helpful.',
          { ...BASE_SETTINGS, proxyUrl: '   ', groqApiKey: 'gsk-x', activeModelId: 'groq/openai/gpt-oss-120b' },
          rec.callbacks
        )
    );
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  });
});

/**
 * The handler is the actual deployed artifact. Drive it with a stub request and
 * a recorder standing in for the Node response, so the relay path is real.
 */
describe('handler (deployed function)', () => {
  const originalFetch = globalThis.fetch;
  const KEY = 'AIza-server-side';
  let savedKey: string | undefined;

  // The handler reads its credential from process.env — that is the whole
  // point of it — so the tests have to put it there.
  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = KEY;
  });

  function makeRes() {
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    return {
      chunks,
      headers,
      body: '',
      // Both Node code paths funnel here: writeHead for the streaming case and
      // a direct assignment for the early-return cases.
      statusCode: 200 as number,
      writeHead(status: number, h: Record<string, string>) {
        this.statusCode = status;
        Object.assign(headers, h);
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      write(chunk: Uint8Array | string) {
        chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        return true;
      },
      end(chunk?: Uint8Array | string) {
        if (chunk !== undefined) {
          this.body = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        }
      },
    };
  }

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    });
  });

  it('relays the provider stream through to the caller', async () => {
    let upstreamAuth = '';
    Object.defineProperty(globalThis, 'fetch', {
      value: async (_url: string, init?: RequestInit) => {
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        upstreamAuth = String(hdrs['x-goog-api-key']);
          return sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"relayed"}],"role":"model"}}]}\n\n']);
      },
      writable: true,
      configurable: true,
    });

    const res = makeRes();
    await handler(
      {
        method: 'POST',
        body: { provider: 'gemini', model: 'gemini-2.5-flash', payload: { contents: [] } },
      },
      res
    );

    assert.equal(upstreamAuth, 'AIza-server-side', 'the proxy must attach the key');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.match(res.chunks.join(''), /relayed/);
  });

  it('passes a provider error status and body straight back', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: async () => jsonResponse({ error: { message: 'quota exhausted' } }, 429),
      writable: true,
      configurable: true,
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { provider: 'gemini', model: 'gemini-2.5-flash' } }, res);
    assert.equal(res.statusCode, 429);
    assert.match(res.body, /quota exhausted/);
  });

  it('refuses non-POST requests', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    assert.equal(res.statusCode, 405);
    assert.match(res.body, /POST only/);
  });

  it('reports a missing key as 503 without calling upstream', async () => {
    let called = false;
    Object.defineProperty(globalThis, 'fetch', {
      value: async () => {
        called = true;
        return jsonResponse({});
      },
      writable: true,
      configurable: true,
    });
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const res = makeRes();
    try {
      await handler({ method: 'POST', body: { provider: 'gemini', model: 'gemini-2.5-flash' } }, res);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
    assert.equal(called, false);
    assert.equal(res.statusCode, 503);
  });

  it('reads its key from the process environment, not from the request', async () => {
    let upstreamAuth = '';
    Object.defineProperty(globalThis, 'fetch', {
      value: async (_url: string, init?: RequestInit) => {
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        upstreamAuth = String(hdrs['x-goog-api-key']);
        return sseResponse(['data: {}\n\n']);
      },
      writable: true,
      configurable: true,
    });
    const res = makeRes();
    await handler(
      {
        method: 'POST',
        // A caller trying to supply its own credential is ignored.
        body: {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          payload: {},
          apiKey: 'attacker-key',
          headers: { Authorization: 'Bearer attacker-key' },
        },
      },
      res
    );
    assert.equal(upstreamAuth, KEY);
    assert.doesNotMatch(res.chunks.join('') + res.body, /attacker-key/);
  });
});

/**
 * The UI refuses to send unless this returns true. It used to be a separate
 * copy of the check in App.tsx that ignored proxyUrl, so a proxy-only
 * deployment popped the setup prompt and never reached the proxy. Keeping one
 * definition is what stops that drifting again.
 */
describe('hasUsableCredential (the setup gate)', () => {
  it('is false with no key and no proxy', () => {
    assert.equal(hasUsableCredential(BASE_SETTINGS), false);
  });

  it('is true for any one of the three keys', () => {
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, geminiApiKey: 'AIzaX' }), true);
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, groqApiKey: 'gsk_x' }), true);
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, openRouterApiKey: 'sk-or-x' }), true);
  });

  it('is true on a proxy alone, with no keys at all', () => {
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, proxyUrl: '/api/chat' }), true);
  });

  it('ignores whitespace-only values', () => {
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, geminiApiKey: '   ' }), false);
    assert.equal(hasUsableCredential({ ...BASE_SETTINGS, proxyUrl: '   ' }), false);
  });
});
