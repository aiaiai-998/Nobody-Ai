# 🤖 Kian AI — a chat client for free open-weight models

A React + TypeScript chat UI that talks to free models through **Google AI
Studio (Gemini)**, [**Groq**](https://console.groq.com) and
[**OpenRouter**](https://openrouter.ai). All three issue free API keys with no
credit card.

---

## ⚠️ Read this first: it needs a key

There is no way to run a real language model in a static web app without either
a key or a multi-gigabyte in-browser model download. Kian AI does **not** fake
it:

- With a key → you get genuine streaming responses from the model you picked.
- Without a key → the app tells you plainly that nothing was sent, and points
  you at the key page. It will not manufacture a plausible-looking answer.
- **Behind a proxy** → if the deployment has [`api/chat.ts`](api/chat.ts)
  running with a key in its environment, visitors need no key at all. See
  [Key-free mode](#-key-free-mode-running-a-proxy).
- **Scripted Offline Demo** is a clearly-labelled non-AI mode for exercising the
  UI with no network and no key. It is a rule-based template, not a model.

Get a free key: [Gemini](https://aistudio.google.com/app/apikey) ·
[Groq](https://console.groq.com/keys) ·
[OpenRouter](https://openrouter.ai/keys). Paste it in **Settings (⚙️)**.

**Your key is never validated, on purpose.** Google AI Studio now issues keys
starting with `AQ.` as well as the older `AIza...`, and provider formats change
without notice. A strict regex would reject perfectly good keys, so Kian AI
trims what you paste and sends it exactly as-is. If the key is wrong you get the
provider's own 401 back, which is the authority that matters.

**Never commit a key.** They belong in the browser's localStorage (per visitor)
or in your host's environment variables (proxy mode) — never in the repository,
and never pasted into chat, an issue, or a screenshot.

---

## 💸 "Free" means $0, not unlimited

No cost per token, no credit card, no subscription. But every free tier is
**request-limited**, and the limits belong to whoever owns the API key — not to
Kian AI.

| Provider | Free tier ceiling | Notes |
|---|---|---|
| **Gemini** (Google AI Studio) | ~**1,000–1,500 requests/day** on Flash-Lite, ~250/day on Flash | Largest free quota here. 1M-token context, reads images. Google may use free-tier prompts to train, and the free tier is not available for serving users in the EU/EEA/UK/Switzerland. |
| **Groq** | ~30 requests/minute + a per-model daily cap | Chat models sit around **1,000 requests/day** *each*, so several Groq models stack. Fastest responses. |
| **OpenRouter** | **50 requests/day**, 20 requests/minute | Rises to **1,000/day** permanently once the account has ever bought $10 of credits. The 20/min cap never changes. |

### Getting the most out of it: **Auto** mode

Pick **"Auto — use every free model"** in the model selector. Instead of dying
when one model hits its limit, Kian walks every free model you have a key for
and moves on:

The order is chosen by quota size, largest first:

1. **Groq** — free caps are *per model* (~1,000 requests/day each), so GPT-OSS
   120B, GPT-OSS 20B, Qwen 3.6 and Kimi K2 stack into several independent pools.
2. **Gemini** — a second provider with its own generous daily allowance.
3. **OpenRouter** — the tightest at 50/day, so it is drained last.

That is 12 free models in the chain with all three keys configured.
- It fails over on 429 / 404 / 5xx and **stops** on 401 (a bad key fails
  everywhere — no point burning quota) or once a model has already started
  streaming (so your answer is never silently swapped mid-sentence).
- The message badge shows which model actually answered, marked `(failover)`.

With all three keys this turns a 50-request ceiling into several thousand
requests per day. It is still finite — it just takes a lot longer to reach.

Things worth knowing before you rely on it:

- **The limits are per API key, and every visitor brings their own.** Kian AI
  stores keys in the visitor's browser, so your deployment has no shared quota
  to exhaust — but it also means each user has to get their own key.
- **Failed requests can still count against the daily quota** on OpenRouter, so
  a retry loop burns allowance. Kian AI surfaces the 429 instead of retrying.
- **Free model rosters rotate.** A model that is `:free` today may not be next
  month. That is why the model list is fetched live rather than hardcoded.
- **Truly unlimited requires paying** — a paid (non-`:free`) model on either
  provider, billed per token.

---

## 🚦 First run

A visitor with no key gets a setup screen instead of a chat that fails: pick a
provider, open the key page, paste the key, done. It also reopens automatically
if they try to send a message with no key configured. "Skip" is always
available and the offline demo works without one.

---

## 📎 Attachments

Click the paperclip, drag a file onto the box, or paste an image from the
clipboard.

| Type | What happens |
|---|---|
| **Images** (png/jpg/webp/gif) | Sent to a vision model as a base64 `image_url` part. In Auto mode Kian routes to a vision-capable model automatically; if you have picked a text-only model it tells you instead of failing at the API. |
| **PDFs** | Text is extracted in your browser with pdf.js and folded into the prompt. Nothing is uploaded anywhere except to the model you chose. |
| **Text files** (.txt, .md, .csv, .json, .html) | Read directly and inlined. |

### Limits

| | Per message | Per file |
|---|---|---|
| **Images** | **10** | 4 MB |
| **PDFs / documents** | **5** | 15 MB |

Those counts are not arbitrary: OpenRouter rejects a request outright above
**20 images and documents combined** (`too many images and documents: 27 + 0 >
20`), so 10 + 5 leaves headroom. Try to add more and the input box tells you
how many were skipped instead of letting the provider 400 the whole request.

Images also stay in the history sent with every follow-up, so a long
conversation accumulates them. The request builder trims to the **10 most
recent** image parts and keeps documents, so you never trip the provider cap
mid-conversation.

Attached text is capped at 24,000 characters, shared across all documents, so
one huge PDF cannot blow the context window. A scanned image-only PDF has no
text layer — Kian says so and suggests attaching it as an image instead.

Vision depends on the model, not the app. Gemini reads images natively; on
OpenRouter the live catalog reports each model's `input_modalities`, with
curated flags as a fallback. If none of your available models take images, you
are told plainly rather than having the attachment silently dropped.

---

## 📱 It's a website, not an app

There is nothing to download or install. Deploy it to any static host and
anyone opens it in a browser.

**Works on:** Windows / macOS / Linux desktop, iPhone, iPad, Android — anything
with a current Chrome, Edge, Firefox or Safari. The layout is responsive down
to phone widths.

**Caveats, all from actual feature detection in the code:**

- 🎤 **Voice input** needs the Web Speech API. Chrome, Edge and Safari
  (14.1+/iOS 14.5+) support it. **Firefox ships it disabled behind an
  `about:config` flag**, so for most Firefox users the button will report
  unsupported rather than fail silently.
- 🔒 **Voice input also requires HTTPS** (or `localhost`). Browsers block the
  microphone on plain HTTP, so deploy behind TLS — every free host above gives
  you that by default.
- 🔊 **Read-aloud** needs `speechSynthesis`, which is near-universal.
- No GPU, no WebGPU and no model download are required — inference happens on
  the provider's servers.
- Reaching a real model needs network access. The **Scripted Offline Demo** is
  the only mode that works without it, and it is not an AI.

**Not currently installable:** there is no web app manifest or service worker,
so browsers won't offer "Install app". It is a website. Adding PWA support is a
small change if you want it to install to a home screen.

---

## 🌟 Features

- **Streaming responses** — token-by-token, with a working **Stop** button that
  actually aborts the request.
- **Auto failover** — walks every free model you have a key for and moves on
  when one is rate-limited, so a single model's quota is not a hard stop.
- **Attachments** — images to vision models, PDFs via client-side text
  extraction, plus drag-and-drop and clipboard paste.
- **Live model catalog** — OpenRouter's current `:free` list is fetched at
  startup, so a model being retired doesn't strand you. Curated presets are the
  fallback when that request fails.
- **Stale-model migration** — ids from earlier builds (`groq/llama-3.3-70b`,
  `openrouter/qwen-2.5-7b`, …) are mapped forward automatically, because saved
  settings live in `localStorage` and outlive the code.
- **Honest errors** — 401 / 402 / 404 / 429 each produce a specific, actionable
  message instead of a generic failure or a silent fallback.
- **Markdown rendering** — code blocks, tables, lists — sanitised with
  DOMPurify before it reaches the DOM, since model output is untrusted.
- **5 personas** — Universal Assistant, Code Master, Creative Writer, Patient
  Educator, Quick & Direct.
- **Voice** — 🎤 speech-to-text input, 🔊 text-to-speech playback.
- **Local-only storage** — sessions, settings and keys stay in your browser.
- **Export** — download any conversation as Markdown.

---

## 🛠️ Development

```bash
npm install
npm run dev        # dev server on 0.0.0.0:5173
npm run build      # tsc -b && vite build
npm test           # unit + integration tests for the AI service
npm run lint       # oxlint
npm run typecheck  # build typecheck + test-file typecheck
```

### Tests

`npm test` runs 102 tests against the real service and proxy modules with a
stubbed `fetch` and synthetic SSE streams. Coverage:

- **`aiService.test.ts`** — model-id → provider/slug routing including migration
  of retired ids; SSE parsing across chunk boundaries, CRLF, comments and a
  missing `[DONE]`; the exact request payload per provider (`model`, auth
  header, `max_completion_tokens` vs `max_tokens`); error mapping for missing
  key, 401, 429 and network failure; abort behaviour; live-catalog filtering and
  vision detection from `input_modalities`.
- **`failover.test.ts`** — chain construction per available key; failover on
  429; refusing to switch model once output has streamed; not retrying a 401;
  image routing to vision models and the resulting `content` array.
- **`gemini.test.ts`** — Gemini's different wire format: `systemInstruction`,
  the `assistant` → `model` role mapping, `inline_data` image parts, the
  `candidates[0].content.parts` SSE shape including signature-only chunks that
  carry no text, the `x-goog-api-key` header, and cross-provider failover.
- **`attachments.test.ts`** — mime classification, document inlining, the
  24,000-character budget across multiple files, image parts only for vision
  models, and real text extraction from a committed PDF fixture.
- **`proxy.test.ts`** — the server-side proxy: provider allow-listing, model-id
  validation (including rejecting `../` that `encodeURIComponent` would leave
  intact), a missing key reported without naming any variable, the client side
  sending no credential when a proxy is configured, the streaming relay driven
  through the real handler, and every rate-limit window including the global
  bill guard.
- **`storage.test.ts`** — the localStorage key migration.

pdf.js itself is only exercised through its Node-compatible build in that last
file; the browser worker wiring is not covered by the suite.

---

## 🚀 Deploy

Any static host works — Vercel, Netlify, Cloudflare Pages. `npm run build`
emits `dist/`.

Keys are entered by each visitor and stored in their own browser, so a public
deployment costs nothing to run and never holds anyone's key.

---

## 🔑 Key-free mode: running a proxy

Want visitors to land and chat with **no setup at all**? Deploy
[`api/chat.ts`](api/chat.ts) with your key in its environment. Step-by-step
instructions are in [**DEPLOY.md**](DEPLOY.md). The key stays on
the server; the browser never sees it.

### What it costs

The free tier is the constraint, not the API. Google's published rates
([pricing](https://ai.google.dev/gemini-api/docs/pricing)) make paid usage cheap
enough that the quota cliff disappears:

| Model | $/1M in | $/1M out | 10,000 short messages |
| --- | --- | --- | --- |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | **~$3** |
| Gemini 2.5 Flash | $0.30 | $2.50 | ~$15.50 |

Roughly three dollars for ten thousand messages, with no midnight reset and no
429s. The paid tier also flips *"used to improve our products"* from Yes to No.

### Setup

1. Put your key in the host's environment (see [`.env.example`](.env.example)):

   ```
   GEMINI_API_KEY=AIza...
   VITE_PROXY_URL=/api/chat
   ```

   `GEMINI_API_KEY` is server-side only. `VITE_PROXY_URL` is build-time and is
   **not** a secret — it is the URL of a public endpoint, and baking it in is
   what removes setup for visitors.

2. Deploy. On Vercel, `vercel.json` already configures the function; the Vite
   preset handles the static build.

3. Done. Visitors send messages immediately; requests relay through the proxy.

Leaving `VITE_PROXY_URL` unset keeps the bring-your-own-key behaviour, where
each visitor pastes a key into Settings.

### Rate limits

The proxy ships with fixed-window counters, defaults in `.env.example`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT_RPM` | 20 | per visitor, per minute |
| `RATE_LIMIT_PER_DAY` | 200 | per visitor, per day |
| `RATE_LIMIT_GLOBAL_PER_DAY` | 2000 | everyone combined — the bill guard |

Exceeding one returns `429` with a `Retry-After` header.

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (a free Upstash
database gives you both) and the counters move to Redis, shared across every
instance, so a cold start cannot reset them and a client cannot dodge the cap
by spreading requests around. If Redis is unreachable the in-memory limiter
still applies — the endpoint does not go wide open.

Without those two variables the counters live in instance memory: they reset on
cold start and are not shared, which stops a casual script rather than a
determined one.

### Still worth knowing

A shared key spends *your* money and carries *your* provider's terms. Read them
before opening this to the public. And the free-tier Gemini key reportedly
cannot be used to serve users in the EU/EEA/UK/Switzerland — the paid tier is
the cleaner route for a public site.

---

## 🧭 Model catalog maintenance

Model ids are `<provider>/<upstream-slug>`; everything after the first `/` is
forwarded verbatim. To update the preset list, edit `DEFAULT_MODELS` in
`src/config/constants.ts`. Add an entry to `LEGACY_MODEL_ALIASES` when you
retire an id, so existing users' saved settings keep working.

---

## Tech stack

React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Lucide icons · marked +
DOMPurify · pdf.js (lazy-loaded) · canvas-confetti
