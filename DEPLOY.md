# Deploying Kian AI so nobody needs an API key

This gets you a public URL where visitors land and chat immediately — no setup
screen, no key entry. Roughly 20 minutes, and about **$3 per 10,000 messages**
after that.

You need: a Google account, a GitHub account, a Vercel account. All free.

---

## 1. Get a paid Gemini key (~5 min)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and sign in.
2. Create a key (or use the one you have).
3. **Enable billing on that Cloud project.** This is the step people miss — the
   free tier needs no card, the paid tier does. Without it you get a 429 the
   moment the free quota runs out, which is the exact problem you're avoiding.
4. **Set a budget cap** in Google Cloud → Billing → Budgets. Make it something
   you're happy losing, like $10/month. Google will email you before it's hit.

Your key stays in the server's environment. It never reaches a browser.

## 2. Put the code on GitHub (~5 min)

The repository is already committed. Push it to a GitHub repo you own —
either "New repository" on github.com and push, or import it. Vercel deploys
from there.

## 3. Import into Vercel (~5 min)

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

## 4. Check it worked (~2 min)

Open your new URL. **You should not see a key prompt.** Send a message — it
should stream back.

If it doesn't:

| Symptom | Cause |
| --- | --- |
| Setup screen appears | `VITE_PROXY_URL` wasn't set at build time. Check it's not scoped to Preview only, then redeploy. |
| `503 no API key configured` | `GEMINI_API_KEY` missing or misnamed. |
| `429` immediately | Billing isn't enabled on the Google project, or you're over the rate limit. |
| `404` on `/api/chat` | `api/chat.ts` isn't in the repo root that Vercel imported. |

## 5. Optional: make the rate limits actually hold

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

## What this costs

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
