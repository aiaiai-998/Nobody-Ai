import React, { useState } from 'react';
import { Key, ExternalLink, Check, ArrowRight, Info, X } from 'lucide-react';

type ProviderTab = 'gemini' | 'groq' | 'openrouter';

interface SetupModalProps {
  isOpen: boolean;
  openRouterApiKey: string;
  groqApiKey: string;
  geminiApiKey: string;
  onSaveOpenRouterKey: (key: string) => void;
  onSaveGroqKey: (key: string) => void;
  onSaveGeminiKey: (key: string) => void;
  onDone: () => void;
  onSkip: () => void;
}

/**
 * Shown on first run. Without a key the app cannot reach any model, so this
 * exists to get a visitor from "just landed" to "working" in about a minute
 * instead of letting their first message fail.
 */
export const SetupModal: React.FC<SetupModalProps> = ({
  isOpen,
  openRouterApiKey,
  groqApiKey,
  geminiApiKey,
  onSaveOpenRouterKey,
  onSaveGroqKey,
  onSaveGeminiKey,
  onDone,
  onSkip,
}) => {
  const [orDraft, setOrDraft] = useState(openRouterApiKey);
  const [groqDraft, setGroqDraft] = useState(groqApiKey);
  const [geminiDraft, setGeminiDraft] = useState(geminiApiKey);
  const [active, setActive] = useState<ProviderTab>('gemini');

  if (!isOpen) return null;

  const hasAnyKey = Boolean(orDraft.trim() || groqDraft.trim() || geminiDraft.trim());

  const handleDone = () => {
    onSaveOpenRouterKey(orDraft.trim());
    onSaveGroqKey(groqDraft.trim());
    onSaveGeminiKey(geminiDraft.trim());
    onDone();
  };

  const COPY: Record<
    ProviderTab,
    { label: string; url: string; placeholder: string; tint: string; border: string; blurb: string }
  > = {
    gemini: {
      label: 'Gemini',
      url: 'https://aistudio.google.com/app/apikey',
      placeholder: 'AIza... or AQ....',
      tint: 'text-emerald-300',
      border: 'focus:border-emerald-500',
      blurb:
        'Sign in with a Google account — no card. The largest free quota of the three, and it ' +
        'reads images. Paste whatever Google gives you: older keys start AIza, newer ones start ' +
        'AQ. — both work. Note that Google may use free-tier prompts to improve its products.',
    },
    groq: {
      label: 'Groq',
      url: 'https://console.groq.com/keys',
      placeholder: 'gsk_...',
      tint: 'text-cyan-300',
      border: 'focus:border-cyan-500',
      blurb:
        'Sign in with email, GitHub or Google — no card. The fastest responses, and its free ' +
        'limit is per model, so adding several Groq models stacks several daily quotas.',
    },
    openrouter: {
      label: 'OpenRouter',
      url: 'https://openrouter.ai/keys',
      placeholder: 'sk-or-v1-...',
      tint: 'text-purple-300',
      border: 'focus:border-purple-500',
      blurb:
        'Sign in with email or GitHub — no card. One key unlocks the widest range of open models. ' +
        'Its free tier is the smallest of the three at 50 requests/day.',
    },
  };

  const providerCopy = COPY[active];
  const drafts: Record<ProviderTab, string> = {
    gemini: geminiDraft,
    groq: groqDraft,
    openrouter: orDraft,
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-cyan-950/60 to-slate-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-100 text-lg">One step to get Kian working</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Kian is free to run, but it needs an API key to reach a model. Both providers
                below issue free keys with no credit card.
              </p>
            </div>
            <button
              onClick={onSkip}
              className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 shrink-0"
              title="Skip for now"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Provider switch */}
          <div className="grid grid-cols-3 gap-2">
            {(['gemini', 'groq', 'openrouter'] as const).map((id) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  active === id
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {COPY[id].label}
                {drafts[id].trim() && (
                  <Check size={12} className="inline ml-1.5 text-emerald-400" />
                )}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">{providerCopy.blurb}</p>

          {/* Get key */}
          <a
            href={providerCopy.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:border-slate-600 text-slate-200 text-xs font-semibold transition-colors"
          >
            <span className="flex items-center gap-2">
              <Key size={14} className={providerCopy.tint} />
              Get a free {providerCopy.label} key
            </span>
            <ExternalLink size={13} className="text-slate-400" />
          </a>

          {/* Paste key */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Paste your {providerCopy.label} key
            </label>
            <input
              type="password"
              value={drafts[active]}
              onChange={(e) => {
                if (active === 'openrouter') setOrDraft(e.target.value);
                else if (active === 'groq') setGroqDraft(e.target.value);
                else setGeminiDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasAnyKey) handleDone();
              }}
              placeholder={providerCopy.placeholder}
              className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none ${providerCopy.border}`}
            />
          </div>

          {/* Privacy note */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
            <Info size={14} className="shrink-0 text-slate-500 mt-0.5" />
            <span>
              Your key is stored only in this browser's local storage and sent directly to{' '}
              {providerCopy.label}'s own API — never to a middleman. Free tiers are rate-limited:
              Gemini and Groq both give over a thousand requests a day, OpenRouter 50. Adding more
              than one provider stacks their quotas. Pick <strong>Auto</strong> in the model
              selector to use every model you have a key for.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
          <button
            onClick={onSkip}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors text-left"
          >
            Skip — I'll add a key later
            <br />
            <span className="text-slate-600">(the offline demo works without one)</span>
          </button>
          <button
            onClick={handleDone}
            disabled={!hasAnyKey}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold text-xs transition-colors shrink-0 ${
              hasAnyKey
                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            Start chatting <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
