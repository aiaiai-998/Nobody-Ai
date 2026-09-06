import type { StreamCallbacks } from '../src/services/aiService';
import type { AppSettings, Message } from '../src/types';

export function sseResponse(chunks: string[], status = 200): Response {
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

/** A stream that emits content and then fails mid-flight. */
export function brokenStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.error(new Error('connection reset'));
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function recorder() {
  const chunks: string[] = [];
  const errors: Error[] = [];
  const modelsUsed: string[] = [];
  let finished: string | null = null;
  const callbacks: StreamCallbacks = {
    onChunk: (text) => chunks.push(text),
    onFinish: (text) => {
      finished = text;
    },
    onError: (err) => errors.push(err),
    onModelUsed: (id) => modelsUsed.push(id),
  };
  return {
    chunks,
    errors,
    modelsUsed,
    get finished() {
      return finished;
    },
    callbacks,
  };
}

export const BASE_SETTINGS: AppSettings = {
  activeModelId: 'openrouter/openai/gpt-oss-20b:free',
  activePersonaId: 'general',
  openRouterApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  proxyUrl: '',
  temperature: 0.7,
  maxTokens: 2048,
  autoSpeech: false,
};

export const HISTORY: Message[] = [
  { id: 'u1', role: 'user', content: 'Hello there', timestamp: 0 },
];

export async function withFetch<T>(
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

/** Counts fetch calls so tests can assert how many models were attempted. */
export function countingFetch(handler: (call: number, init?: RequestInit) => Promise<Response>) {
  let calls = 0;
  const urls: string[] = [];
  return {
    get calls() {
      return calls;
    },
    urls,
    impl: async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      return handler(calls++, init);
    },
  };
}
