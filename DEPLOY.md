# Deploying Kian AI so nobody needs an API key

Both paths below give visitors a URL where they land and chat immediately — no
setup screen, no key entry. The only difference is what happens when the free
quota runs out.

| | **A. Fully free** | **B. Paid** |
| --- | --- | --- |
| Cost to you | **$0** | ~$3 per 10,000 messages |
| Setup for visitors | none | none |
| Roughly per day | ~5,000 requests, then a clear message until midnight | unlimited |
| Needs a card | no | yes |
| Best for | a group you know | anything public |

Start with **A**. You can switch to B later by adding one environment variable —
nothing else changes.

---

# A. Fully free for everyone

Three providers, all with free tiers that need no card. The proxy holds all
three keys; Auto mode then has 12 models to burn through, and when one
provider's quota dies it silently moves to the next rather than erroring.

## A1. Collect three free keys (~10 min)

| Provider | Get a key | Roughly per day |
| --- | --- | --- |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | ~1,000 **per model**, and the app uses 4 |
| Gemini | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | ~250–1,500 (Flash) + ~1,000 (Flash-Lite) |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | 50, shared across all its models |

**Do not enable billing.** Staying off billing is what keeps this at $0.

That works out to roughly **5,000 free requests a day** on conservative
numbers. At ~30 messages a person, that's well over 100 people daily.

Treat these figures as estimates: providers change them without notice, and
published numbers for Groq in particular disagree by an order of magnitude. The
app's own model picker shows what each provider is serving today.

## A2. Environment variables

```
GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-...
VITE_PROXY_URL=/api/chat
```

Leave `RATE_LIMIT_*` at their defaults, or lower `RATE_LIMIT_PER_DAY` so one
person cannot drain the whole pool before others get a turn.

## A3. Deploy

Follow steps 2–3 in section B below (GitHub, then import into Vercel). The
build is identical; only the environment variables differ.

A model that runs out is remembered for the session, so the next message goes
straight to one that still has quota instead of rediscovering four dead ends the
slow way. Cooldowns escalate: a first 429 is treated as a per-minute rate limit
and retried in 60 seconds, a third as an empty daily quota and skipped until
midnight UTC.

## Images through the proxy

Vercel rejects any function request body over **4.5 MB** with a 413, and no
configuration flag changes it. Kian resizes images in the browser (1024px,
JPEG) so ten photos fit; the combined cap is 3 MB per message. If you deploy
somewhere with a tighter limit, lower `MAX_TOTAL_IMAGE_BYTES` in
`src/services/attachments.ts`.

Note that only Gemini and two OpenRouter models accept images — the Groq models
do not — so image messages draw on a smaller share of the free quota than text.

## A4. What happens at the end of the day

When every provider is exhausted the visitor gets a plain-language message
rather than a fake reply or a stack trace, and the quota resets at midnight.
That is the trade you accepted for $0 — it is a ceiling, not a failure.

## Free-tier conditions worth knowing

- On the free tier **Google may use prompts to improve its products.** The paid
  tier says no.
- The free-tier Gemini key reportedly **cannot be used to serve users in the
  EU/EEA/UK/Switzerland.**
- OpenRouter's free endpoints are lowest priority and can be slow or
  unavailable at peak times. That is why they sit last in the chain.

---

# B. Paid: never runs out

About **$3 per 10,000 messages**. Same deployment, plus billing.

You need: a Google account, a GitHub account, a Vercel account.

## B1. Get a paid Gemini key (~5 min)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and sign in.
2. Create a key (or use the one you have).
3. **Enable billing on that Cloud project.** This is the step people miss — the
   free tier needs no card, the paid tier does. Without it you get a 429 the
   moment the free quota runs out, which is the exact problem you're avoiding.
   (Path A deliberately skips this.)
4. **Set a budget cap** in Google Cloud → Billing → Budgets. Make it something
   you're happy losing, like $10/month. Google will email you before it's hit.

Your key stays in the server's environment. It never reaches a browser.

## B2. Put the code on GitHub (~5 min)

The repository is already committed. Push it to a GitHub repo you own —
either "New repository" on github.com and push, or import it. Vercel deploys
from there.

## B3. Import into Vercel (~5 min)

1. [vercel.com](https://vercel.com) → **Add New → Project**.
2. Import your repo. Vercel detects Vite automatically — leave the build
   settings alone.
3. **Before clicking Deploy**, open **Environment Variables** and add:

   | Name | Value | Notes |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | your key | the only secret here |
   | `VITE_PROXY_URL` | `/api/chat` | this is what makes it zero-setup |
   | `RATE_LIMIT_RPM` | `20` | per visitor per minute |
   | `RATE_LIMIT_PER_DAY` | `200` | per visitor per day |
   | `RATE_LIMIT_GLOBAL_PER_DAY` | `2000` | the bill guard |

   `VITE_PROXY_URL` is not a secret — it's the address of a public endpoint.
   Baking it into the build is precisely what stops visitors seeing a setup
   screen. `GEMINI_API_KEY` is the opposite: never prefix a key with `VITE_`.

4. Deploy. `vercel.json` already sets the function timeout.

## B4. Check it worked (~2 min)

Open your new URL. **You should not see a key prompt.** Send a message — it
should stream back.

If it doesn't:

| Symptom | Cause |
| --- | --- |
| Setup screen appears | `VITE_PROXY_URL` wasn't set at build time. Check it's not scoped to Preview only, then redeploy. |
| `503 no API key configured` | `GEMINI_API_KEY` missing or misnamed. |
| `429` immediately | Billing isn't enabled on the Google project, or you're over the rate limit. |
| `404` on `/api/chat` | `api/chat.ts` isn't in the repo root that Vercel imported. |

## B5. Optional: make the rate limits actually hold

The built-in counters live in instance memory. On a public URL that's a
deterrent, not a guarantee — a cold start resets them.

A free [Upstash](https://upstash.com) Redis database gives you two values:

```
UPSTASH_REDIS_REST_URL=https://....upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

Add both and redeploy. If Redis is ever unreachable the in-memory limiter still
applies, so the endpoint doesn't go unprotected.

---

## What B costs

Google's published rates ([pricing](https://ai.google.dev/gemini-api/docs/pricing)):

| Model | $/1M in | $/1M out | 10,000 short messages |
| --- | --- | --- | --- |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | **~$3** |
| Gemini 2.5 Flash | $0.30 | $2.50 | ~$15.50 |

Flash-Lite is the cheap and fast option; Flash answers better. Either way there
is no daily cliff — that's the whole point of paying.

## Before you share it widely

- The **global daily limit is your bill cap**. Set it to what you're willing to
  spend, not higher.
- Read Google's terms. The free-tier Gemini key reportedly can't be used to
  serve users in the EU/EEA/UK/Switzerland; the paid tier is the cleaner route
  for a public site.
- Anything you put behind a public URL will be probed by bots within days. The
  rate limits are what stand between you and a surprise invoice.
