import type { AIModel, SystemPersona } from '../types';

/**
 * Curated model presets.
 *
 * The `id` encodes the upstream slug (`<provider>/<slug>`), so this list is the
 * single place that has to be updated when a provider retires a model. The app
 * also discovers OpenRouter's live `:free` catalog at runtime (see
 * `fetchOpenRouterFreeModels`), so a preset going stale degrades to "that one
 * entry errors out" rather than "the whole app is broken".
 *
 * Last verified against provider catalogs on 2026-09-05:
 *  - Groq deprecated `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`
 *    (shutdown 2026-08-16); `openai/gpt-oss-*` are the documented replacements.
 *  - OpenRouter's free roster rotates; the slugs below were current at that date
 *    and `deepseek/*:free` / `gemma-2-*` are no longer offered for free.
 */
/** Sentinel id: walk every free model the user has a key for, in order. */
export const AUTO_MODEL_ID = 'auto/best-free';

export const DEFAULT_MODELS: AIModel[] = [
  {
    id: AUTO_MODEL_ID,
    name: 'Auto — use every free model',
    provider: 'Auto',
    description:
      'Tries each free model in turn and moves on when one is rate-limited. Best way to avoid running out.',
    badge: 'Recommended',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
  },

  // Ordered by how much free quota each provider gives. Groq and Gemini caps are
  // far larger than OpenRouter's 50/day, so they are drained first.

  {
    id: 'groq/openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (Groq)',
    provider: 'Groq',
    description: 'Highest-quality Groq model, served at very high throughput.',
    badge: 'Ultra Fast',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },
  {
    id: 'groq/openai/gpt-oss-20b',
    name: 'GPT-OSS 20B (Groq)',
    provider: 'Groq',
    description: 'Lightweight and extremely fast. Good free-tier token limits.',
    badge: 'Ultra Fast',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },
  {
    id: 'groq/qwen/qwen3.6-27b',
    name: 'Qwen 3.6 27B (Groq)',
    provider: 'Groq',
    description: 'Separate daily quota from the GPT-OSS models on Groq.',
    badge: 'Ultra Fast',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },
  {
    id: 'groq/moonshotai/kimi-k2-instruct',
    name: 'Kimi K2 (Groq)',
    provider: 'Groq',
    description: 'Another independent Groq quota pool for long conversations.',
    badge: 'Ultra Fast',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
  },

  {
    id: 'gemini/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Gemini',
    description: "Google's fast workhorse. Reads images, 1M-token context.",
    badge: 'Free · Vision',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
    supportsImages: true,
  },
  {
    id: 'gemini/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'Gemini',
    description: 'Largest free daily quota of any model here. Reads images.',
    badge: 'Free · Vision',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Ultra Fast',
    supportsImages: true,
  },

  {
    id: 'openrouter/google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B',
    provider: 'OpenRouter',
    description: "Google's open model. Reads images, fast, multilingual.",
    badge: 'Free · Vision',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
    supportsImages: true,
  },
  {
    id: 'openrouter/openai/gpt-oss-20b:free',
    name: 'GPT-OSS 20B',
    provider: 'OpenRouter',
    description: "OpenAI's open-weight model. Strong general-purpose choice.",
    badge: 'Free',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
  },
  {
    id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B',
    provider: 'OpenRouter',
    description: 'Meta open weights. Reliable all-round chat and writing.',
    badge: 'Free',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Moderate',
  },
  {
    id: 'openrouter/qwen/qwen3-coder:free',
    name: 'Qwen3 Coder',
    provider: 'OpenRouter',
    description: 'Large-context open model specialised for code generation.',
    badge: 'Free · Code',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Moderate',
  },
  {
    id: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra',
    provider: 'OpenRouter',
    description: 'Very large context window for long documents and reasoning.',
    badge: 'Free · 1M ctx',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Moderate',
  },
  {
    id: 'openrouter/nvidia/nemotron-nano-12b-v2-vl:free',
    name: 'Nemotron Nano VL',
    provider: 'OpenRouter',
    description: 'Small vision-language model. Good for describing images.',
    badge: 'Free · Vision',
    isFreeByDefault: true,
    requiresKey: true,
    speed: 'Fast',
    supportsImages: true,
  },

  {
    id: 'offline/scripted-demo',
    name: 'Scripted Offline Demo',
    provider: 'Offline demo',
    description:
      'Canned, rule-based replies for testing the UI with no network. Not a language model.',
    badge: 'Not an AI',
    isFreeByDefault: true,
    requiresKey: false,
    speed: 'Ultra Fast',
  },
];

/**
 * Model ids shipped by earlier versions of this app that no longer resolve to a
 * real endpoint. Existing users have these persisted in localStorage, so map
 * them forward instead of letting the chat fail on a stale slug.
 */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'openrouter/qwen-2.5-7b': 'openrouter/openai/gpt-oss-20b:free',
  'openrouter/gemma-2-9b': 'openrouter/google/gemma-4-31b-it:free',
  'openrouter/deepseek-r1': 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  'groq/llama-3.3-70b': 'groq/openai/gpt-oss-120b',
  'groq/llama-3.1-8b': 'groq/openai/gpt-oss-20b',
  'local/client-offline': 'offline/scripted-demo',
};

export const SYSTEM_PERSONAS: SystemPersona[] = [
  {
    id: 'general',
    name: 'Universal Assistant',
    icon: 'Sparkles',
    description: 'Balanced, helpful, and friendly AI for any question.',
    systemPrompt: 'You are a highly capable, friendly, and knowledgeable AI assistant designed to provide accurate, clear, and helpful answers.',
  },
  {
    id: 'developer',
    name: 'Code Master & Architect',
    icon: 'Code',
    description: 'Expert software developer, debugger, and code architect.',
    systemPrompt: 'You are an expert senior software engineer and tech architect. Provide clean, efficient, bug-free, well-explained code with best practices.',
  },
  {
    id: 'creative',
    name: 'Creative Writer',
    icon: 'Feather',
    description: 'Storyteller, poet, copywriter, and creative brainstormer.',
    systemPrompt: 'You are an imaginative creative writer and copywriter. Craft vivid, engaging, expressive stories, scripts, and content with rich vocabulary.',
  },
  {
    id: 'tutor',
    name: 'Patient Educator',
    icon: 'GraduationCap',
    description: 'Breaks down complex subjects into simple step-by-step explanations.',
    systemPrompt: 'You are an empathetic, world-class tutor. Explain complex concepts using intuitive analogies, step-by-step breakdowns, and clear examples.',
  },
  {
    id: 'concise',
    name: 'Quick & Direct Q&A',
    icon: 'Zap',
    description: 'Delivers laser-focused answers without extra fluff or filler.',
    systemPrompt: 'You are a direct, concise assistant. Answer questions directly, clearly, and concisely without fluff, preambles, or unneeded disclaimers.',
  },
];

export const QUICK_PROMPTS = [
  {
    title: 'Explain Quantum Computing',
    prompt: 'Explain how quantum computing works using an analogy a 10-year-old would easily understand.',
    icon: 'Atom',
  },
  {
    title: 'Build a Web Scraping Script',
    prompt: 'Write a Python script using BeautifulSoup and Requests to extract news titles from a site cleanly with error handling.',
    icon: 'Code',
  },
  {
    title: 'Design a Product Pitch',
    prompt: 'Help me draft a compelling 1-minute elevator pitch for an AI product that helps small businesses automate email support.',
    icon: 'Lightbulb',
  },
  {
    title: 'Debug & Optimize Code',
    prompt: 'How can I optimize slow React component re-renders? Give 4 practical code techniques.',
    icon: 'Cpu',
  },
];
