/**
 * Server-side proxy that holds provider API keys out of the browser.
 *
 * A key compiled into the client bundle is public — Vite inlines `VITE_*`
 * values as literals into the shipped JavaScript, so anyone can read it out of
 * the source and spend your quota. This function keeps the key in the server
 * environment and only ever returns the model's stream.
 *
 * Deploy: set the key(s) as environment variables on your host, then point the
 * app's "API proxy URL" setting at this function (e.g. `/api/chat`).
 *
 * Works on Vercel (`api/*.ts`) and any Node host that calls
 * `handler(req, res)`.
 */

export type ProxyProvider = 'openrouter' | 'groq' | 'gemini';

export interface Upstream {
  url: string;
  headers: Record<string, string>;
}

export type ResolveResult =
  | { ok: true; upstream: Upstream }
  | { ok: false; status: number; message: string };

interface Env {
  [key: string]: string | undefined;
}

const PROVIDERS: Record<
  ProxyProvider,
  { envKey: string; urlFor: (model: string) => string; auth: (key: string) => Record<string, string> }
> = {
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    urlFor: () => 'https://openrouter.ai/api/v1/chat/completions',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    urlFor: () => 'https://api.groq.com/openai/v1/chat/completions',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    urlFor: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:streamGenerateContent?alt=sse`,
    auth: (key) => ({ 'x-goog-api-key': key }),
  },
};

function isProxyProvider(value: unknown): value is ProxyProvider {
  return value === 'openrouter' || value === 'groq' || value === 'gemini';
}

/**
 * Real model ids are slugs: `openai/gpt-oss-20b:free`, `gemini-2.5-flash`.
 * `encodeURIComponent` alone is not enough — it leaves `.` untouched, so
 * `../other/path` would survive encoding. Reject anything that is not plainly a
 * slug before it reaches a URL.
 */
const MODEL_SLUG = /^[A-Za-z0-9._:+-]+(\/[A-Za-z0-9._:+-]+)*$/;

function isSafeModel(model: string): boolean {
  return MODEL_SLUG.test(model) && !model.includes('..');
}

/**
 * Decide where a request goes and how it authenticates. Split out from the HTTP
 * handler because it is the security-critical part: it is what guarantees a
 * caller cannot pick the provider, supply their own model string, or read a key.
 */
export function resolveUpstream(
  provider: unknown,
  model: unknown,
  env: Env
): ResolveResult {
  if (!isProxyProvider(provider)) {
    return { ok: false, status: 400, message: 'provider must be one of: openrouter, groq, gemini.' };
  }

  if (typeof model !== 'string' || !isSafeModel(model)) {
    return { ok: false, status: 400, message: 'model must be a valid model id.' };
  }

  const spec = PROVIDERS[provider];
  const key = env[spec.envKey]?.trim();

  if (!key) {
    // Deliberately vague: never tell a caller which variables exist.
    return { ok: false, status: 503, message: 'This deployment has no API key configured.' };
  }

  return {
    ok: true,
    upstream: {
      url: spec.urlFor(model),
      headers: { 'Content-Type': 'application/json', ...spec.auth(key) },
    },
  };
}

/* ---------- rate limiting ---------- */

export interface RateLimits {
  /** Requests per minute from a single visitor. */
  perMinute: number;
  /** Requests per day from a single visitor. */
  perDay: number;
  /** Requests per day across everyone — the "my bill cannot explode" guard. */
  perDayGlobal: number;
}

export interface RateVerdict {
  ok: boolean;
  retryAfterSeconds: number;
  reason: string;
}

export function defaultLimits(env: Env): RateLimits {
  const num = (key: string, fallback: number) => {
    const raw = Number(env[key]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  return {
    perMinute: num('RATE_LIMIT_RPM', 20),
    perDay: num('RATE_LIMIT_PER_DAY', 200),
    perDayGlobal: num('RATE_LIMIT_GLOBAL_PER_DAY', 2000),
  };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Fixed-window counters held in memory. Honest limitation: on a serverless host
 * each instance has its own counters and they reset on cold start, so this is a
 * deterrent against a casual script rather than a hard guarantee. For a real
 * cap you want a shared store (Upstash, Redis) keyed the same way.
 */
export function createLimiter(limits: RateLimits) {
  const buckets = new Map<string, { minute: number[]; day: number[] }>();
  const globalDay: number[] = [];

  return {
    check(ip: string, now: number): RateVerdict {
      const prune = (arr: number[], window: number) => {
        while (arr.length > 0 && now - arr[0] > window) arr.shift();
      };

      prune(globalDay, DAY);
      if (globalDay.length >= limits.perDayGlobal) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((globalDay[0] + DAY - now) / 1000),
          reason: 'daily limit reached for this service',
        };
      }

      let entry = buckets.get(ip);
      if (!entry) {
        entry = { minute: [], day: [] };
        buckets.set(ip, entry);
      }
      prune(entry.minute, MINUTE);
      prune(entry.day, DAY);

      if (entry.minute.length >= limits.perMinute) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((entry.minute[0] + MINUTE - now) / 1000),
          reason: 'too many requests per minute',
        };
      }
      if (entry.day.length >= limits.perDay) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((entry.day[0] + DAY - now) / 1000),
          reason: 'daily limit reached',
        };
      }

      entry.minute.push(now);
      entry.day.push(now);
      globalDay.push(now);
      return { ok: true, retryAfterSeconds: 0, reason: '' };
    },
  };
}

/** First hop of X-Forwarded-For, falling back to the socket address. */
export function clientIp(req: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const fwd = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof first === 'string' && first.trim()) return first.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

/** Minimal structural types so this needs no host-specific dependency. */
interface Req {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}
interface Res {
  statusCode?: number;
  writeHead(status: number, headers: Record<string, string>): unknown;
  setHeader(name: string, value: string): unknown;
  write(chunk: Uint8Array | string): boolean;
  end(chunk?: Uint8Array | string): unknown;
}

const limiter = createLimiter(defaultLimits(process.env));

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: { message: 'POST only.' } }));
    return;
  }

  const verdict = limiter.check(clientIp(req), Date.now());
  if (!verdict.ok) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    res.end(JSON.stringify({ error: { message: `Slow down: ${verdict.reason}. Try again in ${verdict.retryAfterSeconds}s.` } }));
    return;
  }

  const body = (req.body ?? {}) as { provider?: unknown; model?: unknown; payload?: unknown };

  const resolved = resolveUpstream(body.provider, body.model, process.env);
  if (!resolved.ok) {
    res.statusCode = resolved.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: resolved.message } }));
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(resolved.upstream.url, {
      method: 'POST',
      headers: resolved.upstream.headers,
      body: JSON.stringify(body.payload ?? {}),
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: { message: `Could not reach the provider: ${err instanceof Error ? err.message : String(err)}` },
      })
    );
    return;
  }

  // Pass the provider's status and error body straight through so the client
  // keeps its own 401/429 handling.
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(text || JSON.stringify({ error: { message: `Provider returned ${upstream.status}.` } }));
    return;
  }

  res.writeHead(upstream.status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}
