# 🤖 Aura AI — a chat client for free open-weight models

A React + TypeScript chat UI that talks to open-weight models through
[OpenRouter](https://openrouter.ai) and [Groq](https://console.groq.com). Both
providers issue free API keys.

---

## ⚠️ Read this first: it needs a key

There is no way to run a real language model in a static web app without either
a key or a multi-gigabyte in-browser model download. Aura AI does **not** fake
it:

- With a key → you get genuine streaming responses from the model you picked.
- Without a key → the app tells you plainly that nothing was sent, and points
  you at the key page. It will not manufacture a plausible-looking answer.
- **Scripted Offline Demo** is a clearly-labelled non-AI mode for exercising the
  UI with no network and no key. It is a rule-based template, not a model.

Get a free key: [OpenRouter keys](https://openrouter.ai/keys) ·
[Groq keys](https://console.groq.com/keys). Paste it in **Settings (⚙️)**.

---

## 🌟 Features

- **Streaming responses** — token-by-token, with a working **Stop** button that
  actually aborts the request.
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

`npm test` runs `tests/aiService.test.ts` against the real service module with a
stubbed `fetch` and synthetic SSE streams. It covers:

- model-id → provider/slug routing, including migration of retired ids;
- SSE parsing across chunk boundaries, CRLF, comments, and a missing `[DONE]`;
- the exact request payload sent to each provider (`model`, auth header,
  `max_completion_tokens` vs `max_tokens`);
- error mapping for missing key, 401, 429 and network failure;
- abort behaviour, and the live-catalog filter.

---

## 🚀 Deploy

Any static host works — Vercel, Netlify, Cloudflare Pages. `npm run build`
emits `dist/`; there is no server component.

Keys are entered by each visitor and stored in their own browser, so a public
deployment costs nothing to run and never holds anyone's key.

---

## 🧭 Model catalog maintenance

Model ids are `<provider>/<upstream-slug>`; everything after the first `/` is
forwarded verbatim. To update the preset list, edit `DEFAULT_MODELS` in
`src/config/constants.ts`. Add an entry to `LEGACY_MODEL_ALIASES` when you
retire an id, so existing users' saved settings keep working.

---

## Tech stack

React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Lucide icons · marked +
DOMPurify · canvas-confetti
